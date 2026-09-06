import { describe, expect, it, vi } from 'vitest';
import { createFixturePointerDownHandler } from './fixtureSelection';

describe('3D fixture selection', () => {
  it('selects the fixture body instance on pointer down', () => {
    const onSelectFixture = vi.fn();
    const stopPropagation = vi.fn();
    const handlePointerDown = createFixturePointerDownHandler(
      [{ id: 'fixture-1' }, { id: 'fixture-2' }],
      onSelectFixture,
    );

    handlePointerDown({ instanceId: 1, stopPropagation });

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onSelectFixture).toHaveBeenCalledOnce();
    expect(onSelectFixture).toHaveBeenCalledWith('fixture-2');
  });

  it('does not change selection without a matching body instance', () => {
    const onSelectFixture = vi.fn();
    const handlePointerDown = createFixturePointerDownHandler(
      [{ id: 'fixture-1' }],
      onSelectFixture,
    );

    handlePointerDown({ instanceId: undefined, stopPropagation: vi.fn() });

    expect(onSelectFixture).not.toHaveBeenCalled();
  });
});
