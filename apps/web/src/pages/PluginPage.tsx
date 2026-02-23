import { useParams } from 'react-router-dom';
import { getAccessToken } from '../lib/api';

export function PluginPage() {
  const { name } = useParams<{ name: string }>();
  const token = getAccessToken();
  const src = `/api/plugins/${name}/ui/?nf_token=${token ?? ''}`;

  return <iframe src={src} className="w-full h-full border-none" title={name} />;
}
