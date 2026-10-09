import type { StageLayout } from '../../../shared/types';

export function createStageGesture(preview: (stage: StageLayout) => void, commit: (stage: StageLayout) => void) {
  let initial: StageLayout | null = null;
  let latest: StageLayout | null = null;
  return {
    begin(stage: StageLayout) { initial = stage; latest = stage; },
    update(stage: StageLayout) {
      preview(stage);
      if (initial) latest = stage;
      else commit(stage);
    },
    finish() {
      const before = initial;
      const after = latest;
      initial = latest = null;
      if (before && after && JSON.stringify(before) !== JSON.stringify(after)) commit(after);
    },
  };
}
