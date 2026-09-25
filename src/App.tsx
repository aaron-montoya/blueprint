import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { importBlueprintFile } from './app/commands';
import { restoreSession, startAutosave } from './app/session';
import { useUi } from './app/uiStore';
import { Canvas } from './canvas/Canvas';
import { useLibrary } from './library/libraryStore';
import { DIAGRAM_EXTENSION } from './model/format';
import { Sidebar } from './ui/Sidebar';
import { TitlePanel } from './ui/TitlePanel';
import { Toolbar } from './ui/Toolbar';

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    let stop = () => {};
    void (async () => {
      await Promise.all([useLibrary.getState().load(), restoreSession()]);
      stop = startAutosave();
      setReady(true);
    })();
    return () => stop();
  }, []);

  // Dropping a .blueprint file anywhere on the page opens it.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      if (file.name.endsWith(DIAGRAM_EXTENSION) || file.name.endsWith('.json')) void importBlueprintFile(file);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <ReactFlowProvider>
      <div className={`app${panelOpen ? ' with-panel' : ''}`}>
        <Toolbar panelOpen={panelOpen} togglePanel={() => setPanelOpen((v) => !v)} />
        <Sidebar />
        <main className="main">{ready ? <Canvas /> : <div className="loading">Loading…</div>}</main>
        {panelOpen && <TitlePanel />}
      </div>
      <Toasts />
    </ReactFlowProvider>
  );
}
