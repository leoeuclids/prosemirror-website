import {schema as baseSchema} from "prosemirror-schema-basic"
import {Schema} from "prosemirror-model"

const liquidSpec = {
  group: "inline",
  content: "text*",
  inline: true,
  atom: true,
  toDOM: () => ["span", {type: "liquid"}, 0],
  parseDOM: [{tag: "span", type: "liquid"}]
}

const schema = new Schema({
  nodes: baseSchema.spec.nodes.addBefore("image", "liquid", liquidSpec),
  marks: baseSchema.spec.marks
})

import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { undo, redo } from 'prosemirror-history'
import { StepMap } from 'prosemirror-transform'

class LiquidView {
  constructor(node, view, getPos) {
    this.node = node;
    this.outerView = view;
    this.getPos = getPos;

    this.dom = document.createElement('span');
    this.dom.setAttribute('type', 'liquid');
    this.dom.appendChild(document.createTextNode('{{'));

    this.innerView = new EditorView(this.dom, {
      state: EditorState.create({
        doc: this.node,
        plugins: this.plugins
      }),
      dispatchTransaction: this.dispatchInner.bind(this),
    });

    this.dom.appendChild(document.createTextNode('}}'));

    this.setSelection(0, 0);
  }

  get length() {
    return this.node.nodeSize - 2;
  }

  get plugins() {
    return [
      keymap({
        'Mod-z': () => undo(this.outerView.state, this.outerView.dispatch),
        'Mod-y': () => redo(this.outerView.state, this.outerView.dispatch),
        'ArrowLeft': () => this.maybeEscape(-1),
        'ArrowRight': () => this.maybeEscape(1),
        'Backspace': () => this.maybeRemove(-1),
        'Delete': () => this.maybeRemove(1),
      })
    ];
  }

  selectNode() {
    this.setSelection(0, 0)
  }

  setSelection(from, to) {
    let {state} = this.innerView;
    this.innerView.dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, from, to))
    );
    this.innerView.focus();
  }

  dispatchInner(tr) {
    let { state, transactions } = this.innerView.state.applyTransaction(tr);
    this.innerView.updateState(state);

    if (!tr.getMeta('fromOutside')) {
      let outerTr = this.outerView.state.tr, offsetMap = StepMap.offset(this.getPos() + 1);
      for (let i = 0; i < transactions.length; i++) {
        let steps = transactions[i].steps;
        for (let j = 0; j < steps.length; j++)
          outerTr.step(steps[j].map(offsetMap));
      }
      if (outerTr.docChanged) this.outerView.dispatch(outerTr);
    }
  }

  update(node) {
    if (!node.sameMarkup(this.node)) return false;
    this.node = node;
    if (this.innerView) {
      let state = this.innerView.state;
      let start = node.content.findDiffStart(state.doc.content);
      if (start != null) {
        let {a: endA, b: endB} = node.content.findDiffEnd(state.doc.content);
        let overlap = start - Math.min(endA, endB);
        if (overlap > 0) { endA += overlap; endB += overlap; }
        this.dispatchInner(
          state.tr
            .replace(start, endB, node.slice(start, endA))
            .setMeta('fromOutside', true));
      }
    }
    return true;
  }

  stopEvent(event) {
    return this.innerView && this.innerView.dom.contains(event.target);
  }

  ignoreMutation() { return true; }

  maybeEscape(dir) {
    let { state } = this.innerView;
    let { selection } = state;
    let isOnEdge = (dir < 0)
      ? selection.from === 0
      : selection.to === this.length;

    if (!selection.empty || !isOnEdge) return false;

    let targetPos = this.getPos() + (dir < 0 ? 0 : this.node.nodeSize);
    this.outerView.dispatch(
      this.outerView.state.tr.setSelection(TextSelection.create(this.outerView.state.doc, targetPos))
    );
    this.outerView.focus();

    return true;
  }

  maybeRemove() {
    if (!this.length) {
      let {state} = this.outerView;
      let from = this.getPos();
      let to = from + this.node.nodeSize;

      this.outerView.dispatch(
        state.tr
          .setSelection(TextSelection.create(state.doc, from, to))
          .delete(from, to)
          .scrollIntoView()
      );

      return true;
    }
  }
}

import {keymap} from "prosemirror-keymap"

function arrowHandler(dir) {
  return (state, dispatch) => {
    let { selection, tr } = state
    let side = dir == 'left' || dir == 'up' ? -1 : 1

    if (selection.empty && isNearInlineBlock(state, side)) {
      let targetPos = selection.$head.pos + side
      let $pos = state.doc.resolve(targetPos)
      let newSelection = Selection.findFrom($pos, side, true)
      dispatch(
        tr
          .setSelection(newSelection)
          .scrollIntoView()
      )
      return true
    }

    return false
  };
}

function isNearInlineBlock(state, side) {
  let { selection: { $head: { nodeBefore, nodeAfter } } } = state
  return (side >= 0)
    ? nodeAfter && !nodeAfter.isText && nodeAfter.isInline
    : nodeBefore && !nodeBefore.isText && nodeBefore.isInline
}

const arrowHandlers = keymap({
  ArrowLeft: arrowHandler("left"),
  ArrowRight: arrowHandler("right"),
  ArrowUp: arrowHandler("up"),
  ArrowDown: arrowHandler("down")
})

import {EditorState, Selection} from "prosemirror-state"
import {EditorView} from "prosemirror-view"
import {DOMParser} from "prosemirror-model"
import {exampleSetup} from "prosemirror-example-setup"

const shadowRoot = document.querySelector('#shadow-root').attachShadow({ mode: 'open', delegatesFocus: true })
const mount = document.querySelector("#editor")
shadowRoot.appendChild(mount);
shadowRoot.appendChild(document.querySelectorAll('link[rel="stylesheet"]')[1]);
shadowRoot.appendChild(document.querySelector('style'));
window.view = new EditorView(mount, {
  state: EditorState.create({
    doc: DOMParser.fromSchema(schema).parse(document.querySelector("#content")),
    plugins: exampleSetup({schema}).concat(arrowHandlers)
  }),
  nodeViews: {liquid: (node, view, getPos) => new LiquidView(node, view, getPos)}
})
