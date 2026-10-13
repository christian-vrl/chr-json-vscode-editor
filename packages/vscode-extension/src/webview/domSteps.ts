// The `dom` test hook's steps (003 T8; see DomStep in ../testProbe.ts), shared by the editor's and
// the compare panel's webview test hooks (e2e builds only). Clicks, fills in and presses keys on the
// page as a person would, waiting up to five seconds for each element.
import type { DomStep } from '../testProbe';

/** The first element matching `selector` (and `text`, when given), or null. */
function find(selector: string, text?: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    if (text === undefined || element.textContent?.trim() === text) return element;
  }
  return null;
}

/** Waits for `find(selector, text)` (or, with `gone`, for no match) for up to five seconds. */
async function waitFor(selector: string, text?: string, gone = false): Promise<HTMLElement> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const element = find(selector, text);
    if (gone ? !element : element) return element!;
    if (Date.now() > deadline) {
      const what = text === undefined ? selector : `${selector} "${text}"`;
      throw new Error(gone ? `${what} is still shown` : `nothing matches ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function runSteps(steps: DomStep[]): Promise<(string | null)[]> {
  const reads: (string | null)[] = [];
  for (const step of steps) {
    if ('click' in step) (await waitFor(step.click, step.text)).click();
    else if ('fill' in step) {
      const field = (await waitFor(step.fill)) as HTMLInputElement | HTMLTextAreaElement;
      field.focus();
      field.value = step.value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    } else if ('key' in step) {
      const element = await waitFor(step.on);
      element.focus();
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: step.key,
          ctrlKey: step.ctrl ?? false,
          shiftKey: step.shift ?? false,
          bubbles: true,
          cancelable: true,
        }),
      );
    } else if ('select' in step) {
      const field = (await waitFor(step.select)) as HTMLSelectElement;
      field.value = step.value;
      field.dispatchEvent(new Event('change', { bubbles: true }));
    } else if ('waitFor' in step) await waitFor(step.waitFor, step.text, step.gone);
    else {
      const element = await waitFor(step.read, step.text);
      reads.push(step.attr ? element.getAttribute(step.attr) : (element.textContent ?? ''));
    }
  }
  return reads;
}
