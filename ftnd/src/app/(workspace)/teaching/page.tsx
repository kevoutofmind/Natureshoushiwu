import AITeachingPage from '@/features/ai-teaching/AITeachingPage';

export default async function TeachingPage({
  searchParams,
}: {
  searchParams: Promise<{
    danceId?: string | string[];
    selectedDanceId?: string | string[];
    danceTitle?: string | string[];
  }>;
}) {
  const parameters = await searchParams;
  const danceId = Array.isArray(parameters.danceId)
    ? parameters.danceId[0]
    : parameters.danceId;
  const selectedDanceId = Array.isArray(parameters.selectedDanceId)
    ? parameters.selectedDanceId[0]
    : parameters.selectedDanceId;
  const danceTitle = Array.isArray(parameters.danceTitle)
    ? parameters.danceTitle[0]
    : parameters.danceTitle;

  return (
    <AITeachingPage
      danceId={danceId}
      selectedDanceId={selectedDanceId}
      danceTitle={danceTitle}
    />
  );
}
