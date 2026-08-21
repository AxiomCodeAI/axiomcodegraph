const Parser=require('tree-sitter'); const Py=require('tree-sitter-python');
const p=new Parser(); p.setLanguage(Py);
const src=require('fs').readFileSync(process.argv[2],'utf8');
const t=p.parse(src);
function w(n,d){
  if(n.isNamed) console.log('  '.repeat(d)+n.type+(n.childCount===0?' = '+JSON.stringify(n.text):''));
  for(let i=0;i<n.childCount;i++) w(n.child(i), n.isNamed?d+1:d);
}
w(t.rootNode,0);
