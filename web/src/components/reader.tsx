import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MermaidChart } from './mermaid-chart';

interface ReaderProps {
  content: string;
}

const components: Components = {
  code({ className, children, ...props }) {
    const lang = /language-(\w+)/.exec(className ?? '')?.[1];
    if (lang === 'mermaid') {
      return <MermaidChart code={String(children).trim()} />;
    }
    return <code className={className} {...props}>{children}</code>;
  },
};

export function Reader({ content }: ReaderProps) {
  const md = useMemo(() => content ?? '', [content]);
  return (
    <article className="prose-cn">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {md}
      </ReactMarkdown>
    </article>
  );
}
