import { Row, StatTile } from '@/components';
import { ProfileScreen } from '@/features/profile-screen';
import { useMechanicStats } from '@/hooks/queries';
import { Space } from '@/theme';

export default function MechanicProfile() {
  const stats = useMechanicStats();
  return (
    <ProfileScreen>
      <Row gap={Space.sm}>
        <StatTile value={String(stats.data?.totalJobs ?? '—')} label="Jobs done" />
        <StatTile value={stats.data?.rating ? `${stats.data.rating.toFixed(1)}★` : 'New'} label="Rating" />
      </Row>
    </ProfileScreen>
  );
}
