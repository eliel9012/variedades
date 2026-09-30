import StatsBento from '@/components/ui/stats-bento'

export default function StatsBentoDemo() {
  return <StatsBento office="Presidente" scope="Brasil" round={1} coverage={64} countedSections={1234} totalSections={1920} totalVotes={4520000} candidateCount={14} syncLabel="TSE ao vivo" lastChecked="18:00:00" syncDetail="Próxima consulta: 18:00:15" />
}
