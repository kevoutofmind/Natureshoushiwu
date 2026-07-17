import AITeachingPage from '@/features/ai-teaching/AITeachingPage';

export default async function TeachingPage({
  searchParams,
}: {
  searchParams: Promise<{ danceId?: string | string[] }>;
}) {
  const parameters = await searchParams;
  const danceId = Array.isArray(parameters.danceId)
    ? parameters.danceId[0]
    : parameters.danceId;

  return <AITeachingPage danceId={danceId} />;
}
