import { Command } from 'cmdk';
import { useNavigate } from 'react-router';
import { useUiStore } from '@/stores/ui-store';
import { useTasks } from '@/hooks/use-tasks';
import { formatDuration, formatRelativeTime } from '@/lib/time';

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const setTheme = useUiStore((s) => s.setTheme);
  const navigate = useNavigate();
  const { data: tasks = [] } = useTasks();

  if (!open) return null;

  const close = () => setOpen(false);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4"
         style={{ background: 'rgba(31,37,32,0.12)' }}
         onClick={close}>
      <Command label="Command Menu"
               className="w-full max-w-xl rounded-xl overflow-hidden"
               style={{
                 background: 'var(--bg-surface)',
                 boxShadow: '0 24px 64px -16px rgba(31,37,32,.18), 0 0 0 1px var(--border-subtle)'
               }}
               onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center px-4 py-3.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <span className="mr-3" style={{ color: 'var(--text-tertiary)' }}>🔍</span>
          <Command.Input placeholder="搜索任务、命令…"
                         className="flex-1 bg-transparent outline-none text-sm" />
          <kbd className="text-[11px] px-1.5 py-0.5 rounded border"
               style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>ESC</kbd>
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto py-2">
          <Command.Empty className="px-4 py-6 text-sm text-center"
                         style={{ color: 'var(--text-tertiary)' }}>无匹配结果</Command.Empty>

          <Command.Group heading="任务"
                         className="text-xs uppercase tracking-wider"
                         style={{ color: 'var(--text-tertiary)' }}>
            {tasks.slice(0, 8).map((t) => (
              <Command.Item key={t.id} value={`${t.title} ${t.url}`}
                            onSelect={() => { navigate(`/tasks/${t.id}`); close(); }}
                            className="flex items-center gap-3 px-3 py-2 rounded mx-1 cursor-pointer">
                <div className="w-9 h-9 rounded flex items-center justify-center text-sm"
                     style={{ background: 'var(--accent-3)' }}>🎥</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{t.title || t.url}</div>
                  <div className="mono text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {t.mode} · {t.duration_seconds ? formatDuration(t.duration_seconds) : ''} · {formatRelativeTime(t.updated_at)}
                  </div>
                </div>
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="命令">
            <Command.Item onSelect={() => { navigator.clipboard.writeText('vdl '); close(); }}
                          className="px-3 py-2 rounded mx-1 cursor-pointer text-sm">
              复制 <code className="mono" style={{ color: 'var(--accent-11)' }}>vdl &lt;URL&gt;</code> 命令模板
            </Command.Item>
            <Command.Item onSelect={() => { setTheme('light'); close(); }}
                          className="px-3 py-2 rounded mx-1 cursor-pointer text-sm">切换到浅色主题</Command.Item>
            <Command.Item onSelect={() => { setTheme('dark'); close(); }}
                          className="px-3 py-2 rounded mx-1 cursor-pointer text-sm">切换到深色主题</Command.Item>
            <Command.Item onSelect={() => { setTheme('system'); close(); }}
                          className="px-3 py-2 rounded mx-1 cursor-pointer text-sm">跟随系统主题</Command.Item>
          </Command.Group>
        </Command.List>

        <div className="border-t px-4 py-2.5 text-xs flex items-center justify-between"
             style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
          <div className="flex items-center gap-3">
            <span>↑↓ 导航</span>
            <span>↵ 选择</span>
            <span>ESC 关闭</span>
          </div>
          <span>{tasks.length} 个任务</span>
        </div>
      </Command>
      <style>{`
        [cmdk-item][data-selected="true"] { background: var(--bg-elevated); }
        .mono { font-family: var(--font-mono); }
      `}</style>
    </div>
  );
}
