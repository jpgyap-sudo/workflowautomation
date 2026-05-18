import { STAGE_CONFIG } from '@/lib/api';

export default function StageBadge({ stage }: { stage: string }) {
  const config = STAGE_CONFIG[stage];
  if (!config) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
        {stage}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}
    >
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
}
