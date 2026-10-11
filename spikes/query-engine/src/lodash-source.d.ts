// build.mjs's virtual module: Lodash's minified source as a string, evaluated only inside the engine.
declare module 'lodash-source' {
  const source: string;
  export default source;
}
