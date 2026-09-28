/**
 * Relational arm source scoping: unscoped spans every non-archived source.
 *
 * The `query` op's help text promises `__all__` spans every source for
 * trusted local callers, and the keyword + vector arms honor it. The
 * relational arm's `scopeSources` fell back to `['default']` for an unscoped
 * caller, so on a multi-source brain `gbrain query --source __all__ "who
 * invested in widget-co"` answered relationally from `default` alone — a
 * shipped-contract bug when the edge lives in another source.
 *
 * Pins (PGLite, same harness as test/relational-recall.test.ts):
 *   - unscoped arm resolves the seed in a NON-default source and returns its
 *     edge row (fails pre-fix: seed only resolved against `default`)
 *   - a literal `sourceId: '__all__'` stays fail-closed → empty arm (trusted
 *     local `__all__` arrives unscoped; the literal survives only for callers
 *     whose scope resolution must not widen)
 *   - a scalar sourceId still scopes to exactly that source (unchanged)
 *
 * Traversal remains WITHIN each seed's source (E2=A): only seed resolution
 * widens, never the walk.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { installFixtureChunks } from './helpers/page-projection.ts';
import { buildRelationalArm } from '../src/core/search/relational-recall.ts';
import type { ChunkInput } from '../src/core/types.ts';

let eng: PGLiteEngine;

beforeAll(async () => {
  eng = new PGLiteEngine();
  await eng.connect({});
  await eng.initSchema();
  await eng.executeRaw(
    'INSERT INTO sources (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING',
    ['team'],
  );

  // The entire fixture lives in source `team`; `default` holds nothing.
  // The investor's body never names the company — only the edge connects them.
  await eng.putPage('companies/widget-co', {
    type: 'company', title: 'Widget Co', compiled_truth: 'A payments company.', timeline: '',
  }, { sourceId: 'team' });
  await eng.putPage('people/alice-example', {
    type: 'person', title: 'Alice Example',
    compiled_truth: 'Alice is a seed-stage investor based in Lisbon.', timeline: '',
  }, { sourceId: 'team' });
  // Hydration only surfaces pages with an installed text projection (the
  // currentTextProjectionFilter arm of the shared visibility clause).
  await installFixtureChunks(eng, 'people/alice-example', [{
    chunk_index: 0, chunk_text: 'Alice is a seed-stage investor based in Lisbon.',
    chunk_source: 'compiled_truth', token_count: 8,
  }] satisfies ChunkInput[], { sourceId: 'team' });
  await eng.addLink('people/alice-example', 'companies/widget-co', '', 'invested_in', 'manual',
    undefined, undefined, { fromSourceId: 'team', toSourceId: 'team' });
}, 60_000);

afterAll(async () => { await eng.disconnect(); });

describe('scopeSources spans every source for an unscoped caller', () => {
  test('unscoped arm returns the edge row from a non-default source', async () => {
    const list = await buildRelationalArm(eng, 'who invested in widget-co');
    const alice = list.find(r => r.slug === 'people/alice-example');
    expect(alice).toBeDefined();
    expect(alice!.source_id).toBe('team');
    expect(alice!.relational_via_link_types).toEqual(['invested_in']);
  });

  test("a literal sourceId '__all__' stays fail-closed: empty arm", async () => {
    const list = await buildRelationalArm(eng, 'who invested in widget-co', { sourceId: '__all__' });
    expect(list).toEqual([]);
  });

  test('a scalar sourceId still scopes to exactly that source', async () => {
    const scoped = await buildRelationalArm(eng, 'who invested in widget-co', { sourceId: 'team' });
    expect(scoped.map(r => r.slug)).toContain('people/alice-example');

    const wrong = await buildRelationalArm(eng, 'who invested in widget-co', { sourceId: 'default' });
    expect(wrong).toEqual([]);
  });
});
