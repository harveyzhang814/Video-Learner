import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TaskRow } from './task-row';
import type { Task } from '@/lib/api';

const baseTask: Task = {
  id: 'abc',
  url: 'https://youtube.com/watch?v=x',
  title: 'Test Video',
  mode: 'media',
  duration_seconds: 932,
  status: 'done',
  created_at: Date.now() - 5 * 60_000,
  updated_at: Date.now() - 5 * 60_000
};

describe('TaskRow', () => {
  it('renders title and meta', () => {
    render(<MemoryRouter><TaskRow task={baseTask} /></MemoryRouter>);
    expect(screen.getByText('Test Video')).toBeInTheDocument();
    expect(screen.getByText(/media · 15:32/)).toBeInTheDocument();
  });

  it('shows progress bar only while running', () => {
    const { container, rerender } = render(
      <MemoryRouter><TaskRow task={baseTask} /></MemoryRouter>
    );
    expect(container.querySelector('[data-testid="progress"]')).toBeNull();

    rerender(
      <MemoryRouter>
        <TaskRow task={{ ...baseTask, status: 'running', progress: 47, current_step: '正在转录' }} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('progress')).toBeInTheDocument();
    expect(screen.getByText(/正在转录 47%/)).toBeInTheDocument();
  });

  it('renders failure message', () => {
    render(
      <MemoryRouter>
        <TaskRow task={{ ...baseTask, status: 'failed', error_message: 'fetch HTTP 403' }} />
      </MemoryRouter>
    );
    expect(screen.getByText(/失败.*HTTP 403/)).toBeInTheDocument();
  });
});
