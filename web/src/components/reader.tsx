import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface ReaderProps {
  content: string;
}

export function Reader({ content }: ReaderProps) {
  const md = useMemo(() => content ?? '', [content]);
  return (
    <article className="prose-cn">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {md}
      </ReactMarkdown>
    </article>
  );
}
