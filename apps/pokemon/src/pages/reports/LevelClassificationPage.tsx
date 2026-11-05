import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.ts';
import { ReportCard, TableSkeleton } from '../../components/ReportCard.tsx';
import { RequestState } from '../../components/RequestState.tsx';
import { LevelClassificationTable } from '../../features/reports/LevelClassificationTable.tsx';
import {
  fetchLevelClassification,
  selectLevelClassification,
} from '../../features/reports/reportsSlice.ts';

/** Consulta C. */
export function LevelClassificationPage() {
  const dispatch = useAppDispatch();
  const report = useAppSelector(selectLevelClassification);

  useEffect(() => {
    void dispatch(fetchLevelClassification());
  }, [dispatch]);

  return (
    <ReportCard
      title="Capturas de nivel alto por tipo"
      description="Por tipo, capturas con nivel 50 o más y qué porcentaje representan. Una captura de un Pokémon con dos tipos cuenta en ambos."
    >
      <RequestState
        status={report.status}
        error={report.error}
        onRetry={() => void dispatch(fetchLevelClassification())}
        skeleton={<TableSkeleton rows={10} />}
      >
        <LevelClassificationTable rows={report.data ?? []} />
      </RequestState>
    </ReportCard>
  );
}
