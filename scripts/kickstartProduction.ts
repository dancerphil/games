import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env, getuid } from 'node:process';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serviceName = 'com.dancerphil.games';

interface Command {
    name: string;
    arguments: string[];
}

const runCommand = ({ name, arguments: commandArguments }: Command): void => {
    const result = spawnSync(name, commandArguments, {
        cwd: workspaceRoot,
        env,
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${name} ${commandArguments.join(' ')} 执行失败，退出码 ${result.status}`);
    }
};

const requireBuildArtifact = (relativePath: string): void => {
    if (!existsSync(path.resolve(workspaceRoot, relativePath))) {
        throw new Error(`构建产物不存在：${relativePath}`);
    }
};

interface HealthCheck {
    name: string;
    url: string;
}

const waitForHealth = async ({ name, url }: HealthCheck): Promise<void> => {
    const attempts = 20;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
            if (response.ok && (await response.json()) === 'healthy') {
                console.log(`✓ ${name}健康检查通过`);
                return;
            }
        }
        catch {
            // 服务重启期间连接失败是预期状态，继续等待。
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`${name}健康检查失败：${url}`);
};

const main = async (): Promise<void> => {
    console.log('构建 web 前端...');
    runCommand({ name: 'pnpm', arguments: ['--filter', '@games/web', 'build'] });

    requireBuildArtifact('packages/server/public/index.html');

    const userId = getuid?.();
    if (userId === undefined) throw new Error('无法获取当前用户 ID');

    console.log(`重启 ${serviceName}...`);
    runCommand({
        name: '/bin/launchctl',
        arguments: ['kickstart', '-k', `gui/${userId}/${serviceName}`],
    });

    await waitForHealth({ name: '本地服务', url: 'http://127.0.0.1:8789/api/health' });
    await waitForHealth({ name: '公网服务', url: 'https://games.dancerphil.com/api/health' });
    console.log('✓ games production 发布完成');
};

await main();
