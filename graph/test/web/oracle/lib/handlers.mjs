// Event handlers as HTML (SPEC §10, iter2): no JavaScript is parsed. One row per handler-bearing attribute (a
// Stimulus data-action gives one row per `#` descriptor): attr_as_written, event, modifiers, source_kind, code.
// Decision rules are SPEC §10's table, applied to the attribute name AS WRITTEN, case-insensitively.
import { decodeHTMLAttribute, decodeXML } from 'entities';

// HTML GlobalEventHandlers + WindowEventHandlers + DocumentAndElementEventHandlers + touch/pointer/drag/animation/
// transition events (the fixed list SPEC §10 names)
export const DOM_EVENTS = new Set(`abort afterprint animationcancel animationend animationiteration animationstart auxclick
beforeinput beforematch beforeprint beforetoggle beforeunload blur cancel canplay canplaythrough change click close
command contextlost contextmenu contextrestored copy cuechange cut dblclick drag dragend dragenter dragleave dragover
dragstart drop durationchange emptied ended error focus focusin focusout formdata gotpointercapture hashchange input
invalid keydown keypress keyup languagechange load loadeddata loadedmetadata loadstart lostpointercapture message
messageerror mousedown mouseenter mouseleave mousemove mouseout mouseover mouseup offline online pagehide pagereveal
pageshow pageswap paste pause play playing pointercancel pointerdown pointerenter pointerleave pointermove pointerout
pointerover pointerrawupdate pointerup popstate progress ratechange readystatechange rejectionhandled reset resize
scroll scrollend securitypolicyviolation seeked seeking select selectionchange selectstart slotchange stalled storage
submit suspend timeupdate toggle touchcancel touchend touchmove touchstart transitioncancel transitionend transitionrun
transitionstart unhandledrejection unload visibilitychange volumechange waiting webkitanimationend
webkitanimationiteration webkitanimationstart webkittransitionend wheel`.split(/\s+/));

const ANGULARJS = new Set('click dblclick submit change blur focus keydown keyup keypress mousedown mouseup mouseenter mouseleave mouseover mousemove copy cut paste'.split(' '));
// Stimulus default events by element (an action written without `event->`)
const STIMULUS_DEFAULT = { a: 'click', button: 'click', details: 'toggle', form: 'submit', input: 'input', select: 'change', textarea: 'input' };

/** Which template dialects a page uses, from its attribute names (VUE: any v-*, ALPINE: any x-*). */
export function pageDialects(page) {
  const d = new Set();
  for (const e of page.elements) for (const a of e.attrs) {
    if (/^v-/.test(a.name)) d.add('VUE');
    if (/^x-/.test(a.name)) d.add('ALPINE');
  }
  return d;
}

const hasXDataAncestor = (page, el) => {
  for (let e = el; e; e = e.parentKey ? page.byKey.get(e.parentKey) : null) if (e.attrs.some((a) => a.name === 'x-data')) return true;
  return false;
};

/**
 * Handler rows for one attribute as written: [{written, event, modifiers, kind, code}].
 * `raw` = the value as written in the source; code = that value decoded as the attribute is (SPEC §10).
 */
export function handlersOf(page, el, written, raw, dialects) {
  const n = written; const ln = n.toLowerCase();
  const code = page.xml ? decodeXML(raw) : decodeHTMLAttribute(raw);
  const out = [];
  const push = (event, mods, kind, c = code, source = 'written') => out.push({ written: n, event, modifiers: mods.filter(Boolean).join(','), kind, code: c, source });
  const splitMods = (s, sep) => (s ? s.slice(1).split(sep) : []);
  let m;
  if ((m = /^on([a-z]+)$/i.exec(n))) { if (DOM_EVENTS.has(m[1].toLowerCase())) push(m[1].toLowerCase(), [], 'on_attribute'); return out; }
  if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(ln) && (m = /^\s*javascript:([\s\S]*)$/i.exec(code))) {
    push('navigate', [], 'javascript_url', m[1]); return out;
  }
  if ((m = /^v-on:(\[[^\]]*\]|[^.]+)((?:\.[^.]+)*)$/i.exec(n))) { push(m[1].startsWith('[') ? m[1] : m[1].toLowerCase(), splitMods(m[2], '.'), 'vue'); return out; }
  if ((m = /^x-on:([^.]+)((?:\.[^.]+)*)$/i.exec(n))) { push(m[1].toLowerCase(), splitMods(m[2], '.'), 'alpine'); return out; }
  if ((m = /^@(\[[^\]]*\]|[^.]+)((?:\.[^.]+)*)$/.exec(n))) {
    const vue = dialects.has('VUE'); const alpine = dialects.has('ALPINE');
    if (!vue && !alpine) return out; // a stray `@` attribute on a page with neither dialect: not a handler
    const kind = vue && alpine ? (hasXDataAncestor(page, el) ? 'alpine' : 'vue') : alpine ? 'alpine' : 'vue';
    push(m[1].startsWith('[') ? m[1] : m[1].toLowerCase(), splitMods(m[2], '.'), kind); return out;
  }
  if ((m = /^\(([^.)]+)((?:\.[^.)]+)*)\)$/.exec(n))) { push(m[1].toLowerCase(), splitMods(m[2], '.'), 'angular'); return out; }
  if ((m = /^on-([a-z]+)$/i.exec(n))) { if (DOM_EVENTS.has(m[1].toLowerCase())) push(m[1].toLowerCase(), [], 'angular'); return out; }
  if ((m = /^(?:data-)?ng-([a-z]+)$/i.exec(n))) { if (ANGULARJS.has(m[1].toLowerCase())) push(m[1].toLowerCase(), [], 'angularjs'); return out; }
  if ((m = /^on:([^|]+)((?:\|[^|]+)*)$/i.exec(n))) { push(m[1].toLowerCase(), splitMods(m[2], '|'), 'svelte'); return out; }
  if ((m = /^hx-on(?::(:?)|-)(.+)$/i.exec(n))) { push(`${m[1] ? 'htmx:' : ''}${m[2].toLowerCase()}`, [], 'htmx'); return out; }
  if (ln === 'data-action') {
    for (const act of code.trim().split(/\s+/).filter((x) => x.includes('#'))) {
      const s = /^(?:([^\s>]+?)->)?(.+)$/.exec(act);
      const [evt, ...rest] = (s[1] ?? '').split('@');
      const [name, ...mods] = evt.split('.');
      // no `event->`: Stimulus's default event for the element (stimulus ruling, iter2)
      let event = name ? name.toLowerCase() : null; let source = 'written';
      if (!event) {
        const t = (el.node.attribs?.type ?? '').toLowerCase();
        event = el.tag === 'input' && ['submit', 'button', 'reset'].includes(t) ? 'click' : STIMULUS_DEFAULT[el.tag] ?? '';
        source = event ? 'stimulus_default' : 'stimulus_default_unknown';
      }
      push(event, [...mods, ...rest.map((r) => `@${r}`)], 'stimulus', s[2], source);
    }
    return out;
  }
  return out;
}
