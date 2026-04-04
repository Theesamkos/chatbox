import type { DragEndEvent } from '@dnd-kit/core'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex, Stack, Text, Tooltip } from '@mantine/core'
import { IconArchive, IconMessages, IconSearch } from '@tabler/icons-react'
import { useRouterState } from '@tanstack/react-router'
import type { MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { useSessionList } from '@/stores/chatStore'
import { reorderSessions } from '@/stores/sessionActions'
import { useUIStore } from '@/stores/uiStore'
import SessionItem from './SessionItem'

export interface Props {
  sessionListViewportRef: MutableRefObject<HTMLDivElement | null>
}

export default function SessionList(props: Props) {
  const { t } = useTranslation()
  const { sessionMetaList: sortedSessions, refetch } = useSessionList()
  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)
  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 10,
      },
    }),
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  const onDragEnd = async (event: DragEndEvent) => {
    if (!event.over) {
      return
    }
    if (!sortedSessions) {
      return
    }
    const activeId = event.active.id
    const overId = event.over.id
    if (activeId !== overId) {
      const oldIndex = sortedSessions.findIndex((s) => s.id === activeId)
      const newIndex = sortedSessions.findIndex((s) => s.id === overId)
      await reorderSessions(oldIndex, newIndex)
      refetch()
    }
  }
  const routerState = useRouterState()

  return (
    <>
      <Flex align="center" py="xs" px="md" gap={'xs'}>
        <Text c="chatbox-tertiary" flex={1}>
          {t('Chat')}
        </Text>

        <Tooltip label={t('Search')} openDelay={1000} withArrow>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size={20}
            aria-label={t('Search')}
            onClick={() => setOpenSearchDialog(true, true)}
          >
            <IconSearch />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={t('Clear Conversation List')} openDelay={1000} withArrow>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size={20}
            aria-label={t('Clear Conversation List')}
            onClick={() => NiceModal.show('clear-session-list')}
          >
            <IconArchive />
          </ActionIcon>
        </Tooltip>
      </Flex>

      <DndContext
        modifiers={[restrictToVerticalAxis]}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        {sortedSessions && (
          <SortableContext items={sortedSessions} strategy={verticalListSortingStrategy}>
            {sortedSessions.length === 0 ? (
              <Flex direction="column" align="center" justify="center" flex={1} gap="md" p="xl">
                <Stack align="center" gap="xs">
                  <div className="w-16 h-16 rounded-2xl bg-[var(--chatbox-background-secondary)] flex items-center justify-center">
                    <IconMessages size={32} className="text-[var(--chatbox-tint-tertiary)]" />
                  </div>
                  <Text size="lg" fw={600} c="chatbox-primary">
                    {t('No conversations yet')}
                  </Text>
                  <Text size="sm" c="chatbox-tertiary" ta="center" maw={280}>
                    {t('Start a new chat to begin')}
                  </Text>
                </Stack>
              </Flex>
            ) : (
              <Virtuoso
                style={{ flex: 1 }}
                data={sortedSessions}
                scrollerRef={(ref) => {
                  if (ref instanceof HTMLDivElement) {
                    props.sessionListViewportRef.current = ref
                  }
                }}
                itemContent={(_index, session) => (
                  <SortableItem id={session.id}>
                    <SessionItem
                      selected={routerState.location.pathname === `/session/${session.id}`}
                      session={session}
                    />
                  </SortableItem>
                )}
              />
            )}
          </SortableContext>
        )}
      </DndContext>
    </>
  )
}

function SortableItem(props: { id: string; children?: React.ReactNode }) {
  const { id, children } = props
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}
