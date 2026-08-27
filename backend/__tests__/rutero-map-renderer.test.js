'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../../assets/rutero_map/index.html'), 'utf8');
const inline = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

function renderer() {
  const nodes = [];
  const makeNode = () => {
    const node = { textContent: '', children: [], appendChild(child) { this.children.push(child); },
      setAttribute: jest.fn(), addEventListener: jest.fn(), classList: { toggle: jest.fn() } };
    nodes.push(node); return node;
  };
  const layers = [];
  const context = { window: {}, document: { createElement: makeNode }, Uint8Array,
    maplibregl: {
      Map: class { addControl() {} on() {} fitBounds() {} getSource() { return null; }
        addSource() {} addLayer(layer) { layers.push(layer); } hasImage() { return false; } addImage() {} },
      NavigationControl: class {}, LngLatBounds: class { extend() {} },
      Marker: class { constructor(options) { this.options = options; } setLngLat() { return this; } addTo() { return this; } remove() {} getElement() { return this.options.element; } },
    },
  };
  vm.createContext(context); vm.runInContext(inline, context);
  return { context, layers, nodes };
}

test('route segments preserve order and gaps; no unlocated stop is renumbered', () => {
  const { context, layers, nodes } = renderer();
  const stops = [
    { documentId: 'a', lat: 37, lng: -2, next: true },
    { documentId: 'b', lat: null, lng: null },
    { documentId: 'c', lat: 38, lng: -3 },
    { documentId: 'd', lat: 39, lng: -4 },
  ];
  const segments = context.routeSegments(stops);
  expect(JSON.parse(JSON.stringify(segments.features))).toEqual([
    { type: 'Feature', properties: { from: 3, to: 4 }, geometry: { type: 'LineString', coordinates: [[-3, 38], [-4, 39]] } },
  ]);
  context.window.setRoute({ stops });
  expect(nodes.map(n => n.textContent)).toEqual(['1', '3', '4']);
  expect(nodes[0].className).toContain('next');
  expect(layers.some(layer => layer.id === 'route-direction')).toBe(true);
});

test('popup treats client content as text, never executable HTML', () => {
  const { context } = renderer();
  const dangerous = '<img src=x onerror=alert(1)>';
  const popup = context.popupContent({ nombreCliente: dangerous }, 0);
  expect(popup.children[0].textContent).toContain(dangerous);
  expect(popup.innerHTML).toBeUndefined();
});
