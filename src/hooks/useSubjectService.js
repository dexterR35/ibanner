import { useEffect, useState } from 'react';
import { subjectServiceStatus } from '../core/subject-service.js';

/** Refresh on mount or request, without polling or loading model weights. */
export function useSubjectService() {
  const [revision, setRevision] = useState(0);
  const [connection, setConnection] = useState({ checking: true });
  useEffect(() => {
    const controller = new AbortController();
    setConnection({ checking: true });
    subjectServiceStatus(controller.signal).then(
      (status) => {
        if (!controller.signal.aborted) setConnection(status);
      },
      () => {
        if (!controller.signal.aborted) setConnection({ offline: true });
      },
    );
    return () => controller.abort();
  }, [revision]);
  return { connection, refresh: () => setRevision((value) => value + 1) };
}
