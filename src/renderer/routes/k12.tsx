/**
 * K-12 TutorMeAI Route — /k12
 *
 * The main K-12 dashboard. Shows:
 * - Welcome banner with student/teacher context
 * - Plugin picker (Chess, Timeline Builder, Artifact Investigation Studio)
 * - Recent K-12 sessions
 * - Quick-start buttons
 *
 * When a plugin is selected, it navigates to a new session with the plugin pre-loaded.
 */

import { Badge, Box, Button, Card, Flex, Grid, Stack, Text, Title } from '@mantine/core'
import { IconBrain, IconChessBishop, IconClock, IconSearch, IconSparkles } from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { PluginId } from '@/packages/plugin-bridge'
import { createEmpty } from '@/stores/sessionActions'

/** localStorage key used to pass plugin launch intent from K12 dashboard → session route */
export const K12_PENDING_PLUGIN_KEY = 'chatbridge_k12_pending_plugin'

// @ts-ignore — route will be registered in routeTree after pnpm dev regenerates
export const Route = createFileRoute('/k12' as never)({
  component: K12Dashboard,
})

interface PluginCard {
  id: PluginId
  title: string
  description: string
  icon: React.ReactNode
  color: string
  badge: string
  quickStart: string
}

const PLUGINS: PluginCard[] = [
  {
    id: 'chess',
    title: 'Chess',
    description: 'Play chess with your AI tutor. Learn openings, tactics, and strategy through guided play.',
    icon: <IconChessBishop size={28} />,
    color: '#3b82f6',
    badge: 'Strategy',
    quickStart: 'Start a chess game with me and teach me an opening',
  },
  {
    id: 'timeline',
    title: 'Timeline Builder',
    description: 'Arrange historical events in chronological order. Test your knowledge of history.',
    icon: <IconClock size={28} />,
    color: '#8b5cf6',
    badge: 'History',
    quickStart: 'Load a World War II timeline for me to arrange',
  },
  {
    id: 'artifact_studio',
    title: 'Artifact Investigation Studio',
    description: 'Investigate historical artifacts like a real archaeologist. Observe, analyze, and hypothesize.',
    icon: <IconSearch size={28} />,
    color: '#f59e0b',
    badge: 'Archaeology',
    quickStart: 'Load an ancient artifact for me to investigate',
  },
]

function K12Dashboard() {
  const navigate = useNavigate()

  const handleLaunchPlugin = async (plugin: PluginCard) => {
    // Create a new chat session and navigate to it with the plugin pre-selected
    const session = await createEmpty('chat')
    const sessionId = session.id
    // Store plugin intent so the session route can launch the plugin on mount
    localStorage.setItem(
      K12_PENDING_PLUGIN_KEY,
      JSON.stringify({ pluginId: plugin.id, quickStart: plugin.quickStart, sessionId })
    )
    navigate({
      to: '/session/$sessionId',
      params: { sessionId },
    })
  }

  return (
    <Box
      h="100%"
      style={{
        background: 'linear-gradient(135deg, #0a0a0a 0%, #0f0f1a 50%, #0a0a0a 100%)',
        overflowY: 'auto',
      }}
      p="xl"
    >
      {/* Header */}
      <Stack gap="xs" mb="xl">
        <Flex align="center" gap="sm">
          <IconBrain size={28} color="#3b82f6" />
          <Title order={2} c="white" fw={700}>
            TutorMeAI
          </Title>
          <Badge color="blue" variant="light" size="sm">
            K-12
          </Badge>
        </Flex>
        <Text c="dimmed" size="sm">
          AI-powered learning tools for students and teachers. Choose an activity to get started.
        </Text>
      </Stack>

      {/* Plugin cards */}
      <Stack gap="md" mb="xl">
        <Text c="dimmed" size="xs" tt="uppercase" fw={600} style={{ letterSpacing: '0.08em' }}>
          Learning Activities
        </Text>
        <Grid gutter="md">
          {PLUGINS.map((plugin) => (
            <Grid.Col key={plugin.id} span={{ base: 12, sm: 6, lg: 4 }}>
              <Card
                padding="lg"
                radius="md"
                style={{
                  background: '#141414',
                  border: '1px solid #222',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, transform 0.15s',
                }}
                styles={{
                  root: {
                    '&:hover': {
                      borderColor: plugin.color,
                      transform: 'translateY(-2px)',
                    },
                  },
                }}
                onClick={() => handleLaunchPlugin(plugin)}
              >
                <Flex align="flex-start" gap="md">
                  <Box
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 10,
                      background: `${plugin.color}20`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: plugin.color,
                      flexShrink: 0,
                    }}
                  >
                    {plugin.icon}
                  </Box>
                  <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                    <Flex align="center" gap="xs">
                      <Text fw={600} c="white" size="sm">
                        {plugin.title}
                      </Text>
                      <Badge color="gray" variant="outline" size="xs">
                        {plugin.badge}
                      </Badge>
                    </Flex>
                    <Text c="dimmed" size="xs" lineClamp={2}>
                      {plugin.description}
                    </Text>
                  </Stack>
                </Flex>
                <Button
                  fullWidth
                  mt="md"
                  size="xs"
                  variant="light"
                  color="blue"
                  leftSection={<IconSparkles size={14} />}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleLaunchPlugin(plugin)
                  }}
                >
                  Start Activity
                </Button>
              </Card>
            </Grid.Col>
          ))}
        </Grid>
      </Stack>

      {/* Info section */}
      <Card
        padding="md"
        radius="md"
        style={{ background: '#0d1a2e', border: '1px solid #1e3a5f' }}
      >
        <Flex align="flex-start" gap="md">
          <IconBrain size={20} color="#60a5fa" style={{ flexShrink: 0, marginTop: 2 }} />
          <Stack gap={4}>
            <Text fw={600} c="white" size="sm">
              How TutorMeAI works
            </Text>
            <Text c="dimmed" size="xs" style={{ lineHeight: 1.6 }}>
              Each activity opens a split-view: your AI tutor on the left, the interactive tool on the right.
              The AI can see exactly what you're doing in the tool and provides real-time guidance, hints, and
              feedback. All conversations are private and safe for K-12 students.
            </Text>
          </Stack>
        </Flex>
      </Card>
    </Box>
  )
}
