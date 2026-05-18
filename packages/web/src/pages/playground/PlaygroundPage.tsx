import type { ReactNode } from 'react';
import { Anchor, Divider, Group, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { GameConnecting } from '../../components/GameConnecting';
import { PokerCard } from '../../components/PokerCard';
import { RematchSection } from '../../components/RematchSection';
import { RoomWaiting } from '../../components/RoomWaiting';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <Stack gap="sm">
        <Text fw={700} size="lg">{title}</Text>
        {children}
        <Divider />
    </Stack>
);

export const PlaygroundPage = () => (
    <Stack p="xl" gap="lg" maw={900} mx="auto">
        <Anchor component={Link} to="/" size="sm" c="dimmed">← 返回</Anchor>
        <Title order={1}>Playground</Title>

        <Section title="PokerCard">
            <Text size="sm" c="dimmed">各花色</Text>
            <Group>
                <PokerCard card={12} />
                <PokerCard card={25} />
                <PokerCard card={38} />
                <PokerCard card={51} />
            </Group>
            <Text size="sm" c="dimmed">选中 / 推荐 / 普通</Text>
            <Group>
                <PokerCard card={0} selected />
                <PokerCard card={13} recommended />
                <PokerCard card={26} />
            </Group>
            <Text size="sm" c="dimmed">small</Text>
            <Group>
                <PokerCard card={0} small selected />
                <PokerCard card={13} small recommended />
                <PokerCard card={26} small />
            </Group>
        </Section>

        <Section title="GameConnecting">
            <GameConnecting />
        </Section>

        <Section title="RoomWaiting">
            <RoomWaiting roomId="DEMO123" />
        </Section>

        <Section title="RematchSection">
            <Text size="sm" c="dimmed">无提示</Text>
            <RematchSection hint={null} onRematch={() => {}} />
            <Text size="sm" c="dimmed">对手请求再来一局</Text>
            <RematchSection hint="对手请求再来一局" onRematch={() => {}} />
            <Text size="sm" c="dimmed">双方已准备</Text>
            <RematchSection hint="双方已准备" onRematch={() => {}} />
        </Section>
    </Stack>
);
