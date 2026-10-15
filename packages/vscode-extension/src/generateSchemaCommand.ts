// "Generate JSON Schema" (spec 016 T3, criteria 5–7). Generates a JSON Schema from the active
// document's data, in the CHR JSON Editor or the text editor, with core's `generateSchema`
// (generateSchemaPlan.ts), and writes it to `<name>.schema.json` beside the source, opened in the
// kind of editor the command ran from; when that name is taken a save dialog prefilled with it picks
// where (UNK-035), and closing it writes nothing. A source with no file on a writable file system
// (untitled, `git:`) gives a new untitled JSON document instead. The source's text and file are never
// changed. A document with no source data shows criterion 6's message and nothing changes.
//
// After writing, a notification names the schema; when the document lies in a workspace folder and
// no schema applies to it today (spec 004 criterion 1), it offers "Use for <name>" (UNK-070), which
// appends a `json.schemas` entry to that folder's settings so spec 004 validates the document.
import * as vscode from 'vscode';
import { resolveSchemaAssociation } from '@chr-json-editor/core';
import { commandSource } from './convertCommand';
import { VIEW_TYPE } from './editorProvider';
import type { FormatBadgeController } from './formatBadgeVscode';
import {
  brokenSchemaMessage,
  generatedMessage,
  linkButton,
  planSchema,
  schemaLink,
  schemaName,
  withSchemaLink,
  type SchemaLink,
} from './generateSchemaPlan';
import { collectSchemaScopes } from './schemaSettings';
import { vscodeSchemaWorkspace } from './schemaSettingsVscode';
import { newFileIndent } from './settingsVscode';
import { basename } from './uriPath';

declare const __CHR_TEST_HOOKS__: boolean;

export const GENERATE_SCHEMA_COMMAND = 'chrJsonEditor.generateSchema';

/** Test hooks only: the save dialog's answer and the link button's (true: click it, false: dismiss;
 *  undefined: show them), and what the command showed: messages, notifications with their button,
 *  and the save dialogs' prefilled URIs. */
export const testGenerateSchema: {
  saveAs: ((defaultUri: string) => string | undefined) | undefined;
  link: boolean | undefined;
  messages: string[];
  notifications: { message: string; button: string | undefined }[];
  asked: string[];
} = { saveAs: undefined, link: undefined, messages: [], notifications: [], asked: [] };

export function registerGenerateSchemaCommand(badge: FormatBadgeController): vscode.Disposable {
  return vscode.commands.registerCommand(GENERATE_SCHEMA_COMMAND, (uri?: unknown) =>
    generate(badge, uri instanceof vscode.Uri ? uri : undefined),
  );
}

/** Resolves once the schema is written and opened and the notification answered (or dismissed);
 *  with the schema's URI, or undefined when nothing was written. */
async function generate(
  badge: FormatBadgeController,
  uri: vscode.Uri | undefined,
): Promise<vscode.Uri | undefined> {
  const found = await commandSource(badge, uri);
  if (!found) return undefined;
  const { document, format, custom } = found;
  // Spec 019 I1: the schema file is indented as VS Code indents JSON beside the document.
  const result = planSchema(document.getText(), format, newFileIndent(document.uri, 'json'));
  if (result.kind === 'broken') {
    const position = document.positionAt(result.offset);
    show(brokenSchemaMessage(format, position.line + 1, position.character + 1));
    return undefined;
  }
  if (result.kind === 'too-deep') {
    show(`CHR JSON Editor: ${result.message}`);
    return undefined;
  }
  const source = document.uri;
  const name = basename(source.path);
  const column = vscode.window.tabGroups.activeTabGroup.viewColumn;
  const file =
    !document.isUntitled && vscode.workspace.fs.isWritableFileSystem(source.scheme) === true;
  let target: vscode.Uri | undefined;
  if (file) {
    target = await newFile(source);
    if (!target) return undefined;
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(result.text));
  } else {
    // No file on a writable file system to put the schema beside (criterion 5).
    const created = await vscode.workspace.openTextDocument({
      language: 'json',
      content: result.text,
    });
    target = created.uri;
  }
  if (custom) {
    await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE, {
      viewColumn: column,
      preview: false,
    });
  } else {
    await vscode.window.showTextDocument(target, { viewColumn: column, preview: false });
  }
  // Criterion 7: a button only for a schema file and a document in a workspace folder that has no
  // schema today and is not JSON Lines.
  const folder =
    file && format !== 'jsonl' ? vscode.workspace.getWorkspaceFolder(source) : undefined;
  const link =
    folder &&
    target.scheme === folder.uri.scheme &&
    target.authority === folder.uri.authority &&
    !hasSchema(source, result.documentSchema)
      ? schemaLink(folder.uri.path, source.path, target.path)
      : undefined;
  await notify(name, basename(target.path), folder, link);
  return target;
}

/** Whether a schema applies to the document today: spec 004 criterion 1's resolver, as the CHR
 *  JSON Editor's validation runs it (schemaBinding.ts). */
function hasSchema(document: vscode.Uri, documentSchema: unknown): boolean {
  const workspace = vscodeSchemaWorkspace();
  const association = resolveSchemaAssociation({
    documentUri: document.toString(true),
    documentSchema,
    jsonSchemas: collectSchemaScopes('json', workspace),
    json5Schemas: collectSchemaScopes('json5', workspace),
  });
  return association.source !== 'none';
}

/** Criterion 7: the notification, with the link button when there is a link to make. */
async function notify(
  source: string,
  schemaFile: string,
  folder: vscode.WorkspaceFolder | undefined,
  link: SchemaLink | undefined,
): Promise<void> {
  const message = generatedMessage(schemaFile, source);
  const button = folder && link ? linkButton(source) : undefined;
  if (__CHR_TEST_HOOKS__) testGenerateSchema.notifications.push({ message, button });
  if (__CHR_TEST_HOOKS__ && testGenerateSchema.link !== undefined) {
    if (folder && link && testGenerateSchema.link) await addLink(folder, link);
    return;
  }
  if (!folder || !link) {
    void vscode.window.showInformationMessage(message);
    return;
  }
  // Not awaited: the command is done once the schema is open; the button acts whenever clicked.
  void vscode.window.showInformationMessage(message, button!).then(async (picked) => {
    if (picked === button) await addLink(folder, link);
  });
}

/** Appends `link` to the folder's `json.schemas` setting, keeping its entries (criterion 7). */
async function addLink(folder: vscode.WorkspaceFolder, link: SchemaLink): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('json', folder.uri);
  const existing = configuration.inspect('schemas')?.workspaceFolderValue;
  await configuration.update(
    'schemas',
    withSchemaLink(existing, link),
    vscode.ConfigurationTarget.WorkspaceFolder,
  );
}

/** Where the schema goes: beside the source when the name is free, else where the save dialog says
 *  (undefined when it is closed). The source itself is refused (UNK-035). */
async function newFile(source: vscode.Uri): Promise<vscode.Uri | undefined> {
  const beside = vscode.Uri.joinPath(source, '..', schemaName(basename(source.path)));
  if (!(await exists(beside))) return beside;
  const picked = await saveAs(beside);
  if (!picked) return undefined;
  if (picked.toString() === source.toString()) {
    show('CHR JSON Editor: the schema must not replace the file it comes from.');
    return undefined;
  }
  return picked;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function saveAs(defaultUri: vscode.Uri): Thenable<vscode.Uri | undefined> {
  if (__CHR_TEST_HOOKS__ && testGenerateSchema.saveAs) {
    testGenerateSchema.asked.push(defaultUri.toString());
    const picked = testGenerateSchema.saveAs(defaultUri.toString());
    return Promise.resolve(picked === undefined ? undefined : vscode.Uri.parse(picked));
  }
  return vscode.window.showSaveDialog({
    defaultUri,
    filters: { 'JSON Schema': ['json'] },
    title: 'Save the JSON Schema as',
  });
}

function show(message: string): void {
  if (__CHR_TEST_HOOKS__) testGenerateSchema.messages.push(message);
  void vscode.window.showErrorMessage(message);
}
