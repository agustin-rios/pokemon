import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.ts';
import { ReportCard, TableSkeleton } from '../../components/ReportCard.tsx';
import { RequestState } from '../../components/RequestState.tsx';
import { MonthlyGrowthTable } from '../../features/reports/MonthlyGrowthTable.tsx';
import {
  fetchMonthlyGrowth,
  selectMonthlyGrowth,
} from '../../features/reports/reportsSlice.ts';

/** Consulta A. */
export function MonthlyGrowthPage() {
  const dispatch = useAppDispatch();
  const report = useAppSelector(selectMonthlyGrowth);

  useEffect(() => {
    void dispatch(fetchMonthlyGrowth());
  }, [dispatch]);

  return (
    <ReportCard
      title="Crecimiento mensual de capturas"
      description="Capturas por mes y variación porcentual respecto del mes anterior."
    >
      <RequestState
        status={report.status}
        error={report.error}
        onRetry={() => void dispatch(fetchMonthlyGrowth())}
        skeleton={<TableSkeleton rows={12} />}
      >
        <MonthlyGrowthTable rows={report.data ?? []} />
      </RequestState>
    </ReportCard>
  );
}
