import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Task, type Note } from '@/lib/api';

export function useMediaInfo(id: string | undefined) {
  return useQuery({
    queryKey: ['task', id, 'media-info'],
    queryFn: () => api.getMediaInfo(id!),
    enabled: Boolean(id),
    staleTime: Infinity,
  });
}

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => (await api.listTasks(200)).tasks,
    staleTime: 60_000
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: async () => (await api.getTask(id!)).task,
    enabled: Boolean(id),
    staleTime: 30_000
  });
}

export function useSteps(id: string | undefined) {
  return useQuery({
    queryKey: ['task', id, 'steps'],
    queryFn: async () => (await api.getSteps(id!)).steps,
    enabled: Boolean(id),
    staleTime: 10_000
  });
}

export function useContent(id: string | undefined, type: 'summary' | 'article' | 'transcript') {
  return useQuery({
    queryKey: ['task', id, 'content', type],
    queryFn: () => api.getContent(id!, type),
    enabled: Boolean(id),
    staleTime: Infinity
  });
}

export function useCancelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancel(id),
    onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: ['task', id] })
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] })
  });
}

export function useReveal() {
  return useMutation({ mutationFn: (id: string) => api.reveal(id) });
}

export function useNotes(taskId: string | undefined) {
  return useQuery({
    queryKey: ['task', taskId, 'notes'],
    queryFn: () => api.listNotes(taskId!),
    enabled: Boolean(taskId),
    staleTime: 0,
  });
}

export function useAddNote(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { anchor?: string; mediaTimestamp?: number; body: string }) =>
      api.addNote(taskId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', taskId, 'notes'] }),
  });
}

export function useUpdateNote(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string }) =>
      api.updateNote(taskId, noteId, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', taskId, 'notes'] }),
  });
}

export function useDeleteNote(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.deleteNote(taskId, noteId),
    onMutate: async (noteId) => {
      await qc.cancelQueries({ queryKey: ['task', taskId, 'notes'] });
      const prev = qc.getQueryData<Note[]>(['task', taskId, 'notes']);
      qc.setQueryData<Note[]>(
        ['task', taskId, 'notes'],
        (old) => (old ?? []).filter((n) => n.id !== noteId)
      );
      return { prev };
    },
    onError: (_err, _noteId, ctx) => {
      if (ctx?.prev) qc.setQueryData(['task', taskId, 'notes'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['task', taskId, 'notes'] }),
  });
}

export type { Task };
