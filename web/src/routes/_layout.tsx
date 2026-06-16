import { Outlet } from 'react-router';
import { useTaskStream } from '@/hooks/use-task-stream';
import { useGlobalHotkeys } from '@/hooks/use-hotkeys';

export default function RootLayout() {
  useTaskStream();
  useGlobalHotkeys();
  return <Outlet />;
}
