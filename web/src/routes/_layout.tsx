import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { useTaskStream } from '@/hooks/use-task-stream';
import { useGlobalHotkeys } from '@/hooks/use-hotkeys';
import { CommandPalette } from '@/components/command-palette';
import { useUiStore } from '@/stores/ui-store';

export default function RootLayout() {
  useTaskStream();
  useGlobalHotkeys();
  const proseTheme = useUiStore((s) => s.proseTheme);

  useEffect(() => {
    document.documentElement.dataset.proseTheme = proseTheme;
  }, [proseTheme]);

  return (
    <>
      <Outlet />
      <CommandPalette />
    </>
  );
}
