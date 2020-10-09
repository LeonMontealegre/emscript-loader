/**
 * @jest-environment node
 */
import compiler from './compiler.js';

test('Inserts name and outputs JavaScript', async () => {
  const stats = (await compiler('example.cpp', { includes: ["~/Dropbox/Projects/Libraries/Cpp/include"] })).toJson();

  const output = stats.modules[0].source;

  expect(output.length).toBeGreaterThan(0);

  expect(stats.assets.length).toBeGreaterThan(1);

  const wasm = stats.assets[1];

  expect(wasm.size).toBeGreaterThan(0);
});