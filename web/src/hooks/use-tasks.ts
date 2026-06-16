import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Task } from '@/lib/api';

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

export type { Task };
