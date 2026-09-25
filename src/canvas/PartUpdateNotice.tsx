import { useMemo, useState } from 'react';
import { toast } from '../app/uiStore';
import { allParts, useLibrary } from '../library/libraryStore';
import { outdatedParts } from '../library/partUpdates';
import { useDiagram } from '../store/diagramStore';

/**
 * Shown when parts in this diagram are older than the library's version
 * (diagrams keep their own copy of each part). One click updates them.
 */
export function PartUpdateNotice() {
  const nodes = useDiagram((s) => s.nodes);
  const diagramId = useDiagram((s) => s.diagramId);
  const updateParts = useDiagram((s) => s.updateParts);
  const custom = useLibrary((s) => s.custom);
  const library = useMemo(() => allParts(custom), [custom]);
  const outdated = useMemo(() => outdatedParts(nodes, library), [nodes, library]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const key = `${diagramId}:${outdated.map((o) => o.node.id).join(',')}`;
  if (!outdated.length || dismissed === key) return null;

  const names = [...new Set(outdated.map((o) => o.latest.name))];
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
  return (
    <div className="update-notice" role="status" onPointerDown={(e) => e.stopPropagation()}>
      <span>
        <strong>
          {outdated.length} part{outdated.length === 1 ? '' : 's'}
        </strong>{' '}
        in this diagram {outdated.length === 1 ? 'has' : 'have'} a newer library version ({shown}).
      </span>
      <button
        className="btn small primary"
        onClick={() => {
          const removed = updateParts(outdated);
          toast(
            `Updated ${outdated.length} part${outdated.length === 1 ? '' : 's'}` +
              (removed ? ` — ${removed} wire${removed === 1 ? '' : 's'} removed (their pins no longer exist). Ctrl+Z to undo.` : '. Ctrl+Z to undo.'),
          );
        }}
      >
        Update
      </button>
      <button className="icon-btn tiny" title="Not now" onClick={() => setDismissed(key)}>
        ×
      </button>
    </div>
  );
}
