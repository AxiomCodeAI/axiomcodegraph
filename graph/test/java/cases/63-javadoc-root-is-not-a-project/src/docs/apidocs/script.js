var moduleSearchIndex;
function loadScripts(doc, tag) {
    createElem(doc, tag, 'search.js');
}
function createElem(doc, tag, path) {
    var script = doc.createElement(tag);
    script.src = path;
}
