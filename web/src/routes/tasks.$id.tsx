import { useParams } from 'react-router';
export default function TaskDetail() {
  const { id } = useParams();
  return <div className="p-8">Task detail: {id}</div>;
}
