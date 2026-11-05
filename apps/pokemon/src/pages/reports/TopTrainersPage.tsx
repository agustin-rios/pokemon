import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.ts';
import { ReportCard, TableSkeleton } from '../../components/ReportCard.tsx';
import { RequestState } from '../../components/RequestState.tsx';
import { TopTrainersByRegion } from '../../features/reports/TopTrainersByRegion.tsx';
import {
  fetchTopTrainers,
  selectTopTrainers,
} from '../../features/reports/reportsSlice.ts';

/** Consulta B. */
export function TopTrainersPage() {
  const dispatch = useAppDispatch();
  const report = useAppSelector(selectTopTrainers);

  useEffect(() => {
    void dispatch(fetchTopTrainers());
  }, [dispatch]);

  return (
    <ReportCard
      title="Top entrenadores por región"
      description="Los 3 entrenadores con más capturas de cada región."
    >
      <RequestState
        status={report.status}
        error={report.error}
        onRetry={() => void dispatch(fetchTopTrainers())}
        skeleton={<TableSkeleton rows={6} />}
      >
        <TopTrainersByRegion rows={report.data ?? []} />
      </RequestState>
    </ReportCard>
  );
}
