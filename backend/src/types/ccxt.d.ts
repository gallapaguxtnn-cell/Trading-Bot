declare module 'ccxt' {
  export class Exchange {
    [key: string]: any;
  }
  const ccxt: { [key: string]: any };
  export default ccxt;
  export = ccxt;
}
