import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { openEventStream } from '@/lib/sse';

export function useTaskStream() {
  const qc = useQueryClient();
  useEffect(() => {
    const close = openEventStream((e) => {
      switch (e.type) {
        case 'task.created':
        case 'task.deleted':
          qc.invalidateQueries({ queryKey: ['tasks'] });
          break;
        case 'task.update':
          qc.invalidateQueries({ queryKey: ['task', e.taskId] });
          qc.invalidateQueries({ queryKey: ['tasks'] });
          break;
        case 'step.update':
          qc.invalidateQueries({ queryKey: ['task', e.taskId, 'steps'] });
          break;
      }
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        qc.invalidateQueries({ queryKey: ['tasks'] });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { close(); document.removeEventListener('visibilitychange', onVisible); };
  }, [qc]);
}
