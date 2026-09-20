import { useTranslation } from 'react-i18next'

import { Card, CardHeader } from '../ui/Card'

export function PlannedPage({ messageKey }: { messageKey: string }) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader title={t('common.planned')} description={t(messageKey)} />
      <p className="text-[12px] text-faint">{t('overlay.phasePlanned')}</p>
    </Card>
  )
}
