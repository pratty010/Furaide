// Per-cell glyph pools for the 7 header art fields.

export const CODE_SNIPPETS: string[] = [
  `function refactorAuth(req,res){const token=req.headers['authorization'];if(!token)return res.status(401).send('Unauthorized');const decoded=verify(token,process.env.SECRET);req.user=decoded;next();}function refactorAuth(req,res){const token=req.headers['authorization'];if(!token)return res.status(401).send('Unauthorized');const decoded=verify(token,process.env.SECRET);req.user=decoded;next();}`,
  `async function processPayment(order){const stripe=new Stripe(KEY);const intent=await stripe.paymentIntents.create({amount:order.total,currency:'usd'});return intent.client_secret;}async function processPayment(order){const stripe=new Stripe(KEY);const intent=await stripe.paymentIntents.create({amount:order.total,currency:'usd'});return intent.client_secret;}`,
  `const compile=(ast)=>ast.children.map(node=>node.type==='Function'?emitFunc(node):emitExpr(node)).join('\n');const compile=(ast)=>ast.children.map(node=>node.type==='Function'?emitFunc(node):emitExpr(node)).join('\n');const compile=(ast)=>`,
  `export interface ExtensionAPI{on(evt:string,cb:Function):void;getAllTools():ToolInfo[];getCommands():SlashCommandInfo[];}export interface ExtensionAPI{on(evt:string,cb:Function):void;getAllTools():ToolInfo[];getCommands():SlashCommandInfo[];}export interface Extension`,
  `for(let i=0;i<items.length;i++){const item=items[i];if(item.type==='error'){throw new Error(item.msg);}else{processItem(item);}}for(let i=0;i<items.length;i++){const item=items[i];if(item.type==='error'){throw new Error(item.msg);}else{processItem(item);}}for(let i=0;i<`,
  `const resolve=(path)=>require.resolve(path);const load=(mod)=>import(mod).then(m=>m.default);const cache=new Map();const cached=(key)=>cache.get(key)??load(key).then(m=>(cache.set(key,m),m));const resolve=(path)=>require.resolve(path);const load=(mod)=>`,
  `class EventEmitter{#handlers={};on(evt,cb){(this.#handlers[evt]??=[]).push(cb);}emit(evt,...args){this.#handlers[evt]?.forEach(cb=>cb(...args));}}class EventEmitter{#handlers={};on(evt,cb){(this.#handlers[evt]??=[]).push(cb);}emit(evt,...args){this.#handlers`,
];

// Half-width katakana glyphs for Matrix-rain / kana-field pieces.
// All entries are single-cell-width so grid positioning stays aligned.
export const KATAKANA_POOL = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ0123456789";

export function pickCodeSnippet(): string {
  return CODE_SNIPPETS[Math.floor(Math.random() * CODE_SNIPPETS.length)]!;
}
