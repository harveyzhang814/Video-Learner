import { Outlet } from 'react-router';
import { useTaskStream } from '@/hooks/use-task-stream';
import { useGlobalHotkeys } from '@/hooks/use-hotkeys';
import { CommandPalette } from '@/components/command-palette';

export default function RootLayout() {
  useTaskStream();
  useGlobalHotkeys();
  return (
    <>
      <Outlet />
      <CommandPalette />
    </>
  );
}
