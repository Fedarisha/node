import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { ICommandResponse } from '@common/types/command-response.type';
import {
    ProbeFedarishaUserCommand,
    ProvisionFedarishaUserCommand,
    RevokeFedarishaUserCommand,
} from '@libs/contracts/commands';

import { IPakStorage, PakService, PakUserAlreadyExistsError } from './pak.service';
import { ISelectelPakStorage, SelectelPakService } from './selectel-pak.service';
import { IStaticPakStorage, StaticPakService } from './static-pak.service';
import { PakProviderConflictError } from './pak-provider.interface';
import { InternalService } from '../internal/internal.service';

type ProviderKind = 'vkcloud-pak' | 'selectel-iam' | 'static';

interface IRawStorageSettings {
    type?: string;
    bucket?: string;
    endpoint?: string;
    region?: string;
    prefix?: string;
    accessKey?: string;
    secretKey?: string;
    pathStyle?: boolean;
    iam?: {
        accountId?: string;
        projectName?: string;
        projectId?: string;
        username?: string;
        password?: string;
        identityUrl?: string;
        apiUrl?: string;
    };
}

interface IFedarishaInboundSettings {
    storage?: IRawStorageSettings;
}

interface IXrayInbound {
    tag?: string;
    protocol?: string;
    settings?: IFedarishaInboundSettings;
}

interface IResolvedStorage {
    kind: ProviderKind;
    vkcloud?: IPakStorage;
    selectel?: ISelectelPakStorage;
    static?: IStaticPakStorage;
}

@Injectable()
export class FedarishaPakService {
    private readonly logger = new Logger(FedarishaPakService.name);

    constructor(
        private readonly internalService: InternalService,
        private readonly pakService: PakService,
        private readonly selectelPakService: SelectelPakService,
        private readonly staticPakService: StaticPakService,
    ) {}

    public async provisionUser(
        body: ProvisionFedarishaUserCommand.Request,
    ): Promise<ICommandResponse<ProvisionFedarishaUserCommand.Response['response']>> {
        const storage = await this.resolveStorage(body.inboundTag);
        if (!storage) {
            return this.failProvision(
                `fedarisha inbound ${body.inboundTag} not found in xray config`,
            );
        }

        try {
            const pakUserName = this.buildPakUserName(body.userUuid, body.inboundTag);
            const result = await this.createWithReclaim(storage, pakUserName, body.prefix);
            return {
                isOk: true,
                response: {
                    isOk: true,
                    accessKey: result.accessKey,
                    secretKey: result.secretKey,
                    error: null,
                },
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`provisionUser ${body.userUuid}: ${msg}`);
            return this.failProvision(msg);
        }
    }

    // Recovers from a stale orphan PAK / IAM credential: when createKey
    // reports a conflict the panel forgot the secret (DB wipe / meta reset)
    // but the credential is still bound to the user prefix. Deleting it and
    // retrying is safe — the same (userUuid, inboundTag) handle scopes
    // the new credential to the same prefix, so we never overwrite another
    // user's data.
    private async createWithReclaim(storage: IResolvedStorage, userName: string, prefix: string) {
        try {
            return await this.dispatchCreate(storage, userName, prefix);
        } catch (error) {
            if (!this.isReclaimable(error)) throw error;
            this.logger.warn(
                `Reclaiming orphan credential for user ${userName} on prefix ${prefix}`,
            );
            await this.dispatchDelete(storage, userName, prefix);
            return await this.dispatchCreate(storage, userName, prefix);
        }
    }

    private isReclaimable(error: unknown): boolean {
        return (
            error instanceof PakUserAlreadyExistsError || error instanceof PakProviderConflictError
        );
    }

    public async revokeUser(
        body: RevokeFedarishaUserCommand.Request,
    ): Promise<ICommandResponse<RevokeFedarishaUserCommand.Response['response']>> {
        const storage = await this.resolveStorage(body.inboundTag);
        if (!storage) {
            return this.failRevoke(`fedarisha inbound ${body.inboundTag} not found in xray config`);
        }

        try {
            const pakUserName = this.buildPakUserName(body.userUuid, body.inboundTag);
            await this.dispatchDelete(storage, pakUserName, body.prefix);
            return { isOk: true, response: { isOk: true, error: null } };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`revokeUser ${body.userUuid}: ${msg}`);
            return this.failRevoke(msg);
        }
    }

    public async probeUser(
        body: ProbeFedarishaUserCommand.Request,
    ): Promise<ICommandResponse<ProbeFedarishaUserCommand.Response['response']>> {
        const storage = await this.resolveStorage(body.inboundTag);
        if (!storage) {
            return this.failProbe(`fedarisha inbound ${body.inboundTag} not found in xray config`);
        }

        try {
            const exists = await this.dispatchProbe(
                storage,
                body.accessKey,
                body.secretKey,
                body.prefix,
            );
            return { isOk: true, response: { isOk: true, exists, error: null } };
        } catch (error) {
            // Reaches here only on transport / unexpected status — panel will
            // keep the cached PAK rather than re-issue on infra hiccup.
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.warn(`probeUser ${body.userUuid}: ${msg}`);
            return this.failProbe(msg);
        }
    }

    private async dispatchCreate(storage: IResolvedStorage, userName: string, prefix: string) {
        switch (storage.kind) {
            case 'selectel-iam':
                return this.selectelPakService.createKey(storage.selectel!, userName, prefix);
            case 'static':
                return this.staticPakService.createKey(storage.static!, userName, prefix);
            default:
                return this.pakService.createKey(storage.vkcloud!, userName, prefix);
        }
    }

    private async dispatchDelete(
        storage: IResolvedStorage,
        userName: string,
        prefix: string,
    ): Promise<void> {
        switch (storage.kind) {
            case 'selectel-iam':
                await this.selectelPakService.deleteKey(storage.selectel!, userName, prefix);
                return;
            case 'static':
                await this.staticPakService.deleteKey();
                return;
            default:
                await this.pakService.deleteKey(storage.vkcloud!, userName, prefix);
        }
    }

    private async dispatchProbe(
        storage: IResolvedStorage,
        accessKey: string,
        secretKey: string,
        prefix: string,
    ): Promise<boolean> {
        switch (storage.kind) {
            case 'selectel-iam':
                return this.selectelPakService.probeKey(
                    storage.selectel!,
                    accessKey,
                    secretKey,
                    prefix,
                );
            case 'static':
                return this.staticPakService.probeKey(
                    storage.static!,
                    accessKey,
                    secretKey,
                    prefix,
                );
            default:
                return this.pakService.probeKey(storage.vkcloud!, accessKey, secretKey, prefix);
        }
    }

    // VK Cloud PAK usernames live in a per-master-account namespace, not per
    // bucket — two inbounds that share master credentials but write to
    // different buckets will collide on PUT (UserAlreadyExists) and the
    // subsequent DELETE on the second bucket returns 404 because the orphan
    // PAK is anchored to the first bucket. Disambiguate by hashing the
    // inboundTag into the PAK userName so each (user, inbound) pair claims a
    // distinct namespace entry. The Selectel adapter reuses this same value
    // as its S3-credentials `name` so revoke can locate the right pair.
    private buildPakUserName(userUuid: string, inboundTag: string): string {
        const tagHash = createHash('sha1').update(inboundTag).digest('hex').slice(0, 8);
        return `${userUuid}-${tagHash}`;
    }

    private async resolveStorage(inboundTag: string): Promise<IResolvedStorage | null> {
        const config = await this.internalService.getXrayConfig();
        const inbounds = (config?.inbounds as IXrayInbound[] | undefined) ?? [];
        const inbound = inbounds.find((i) => i.tag === inboundTag && i.protocol === 'fedarisha');
        const raw = inbound?.settings?.storage;
        if (!raw) return null;

        const kind = this.resolveProviderKind(raw.type);
        if (!kind) {
            this.logger.error(
                `inbound ${inboundTag}: storage.type must be explicitly set to one of ` +
                    `"vkcloud-pak" | "selectel-iam" | "static" (got ${JSON.stringify(raw.type)})`,
            );
            return null;
        }

        switch (kind) {
            case 'selectel-iam': {
                const selectel = this.buildSelectelStorage(raw);
                return selectel ? { kind, selectel } : null;
            }
            case 'static': {
                const staticStorage = this.buildStaticStorage(raw);
                return staticStorage ? { kind, static: staticStorage } : null;
            }
            case 'vkcloud-pak': {
                const vkcloud = this.buildVkCloudStorage(raw);
                return vkcloud ? { kind, vkcloud } : null;
            }
        }
    }

    private resolveProviderKind(type: string | undefined): ProviderKind | null {
        if (type === 'vkcloud-pak' || type === 'selectel-iam' || type === 'static') return type;
        return null;
    }

    private buildVkCloudStorage(raw: IRawStorageSettings): IPakStorage | null {
        if (!raw.bucket || !raw.endpoint || !raw.accessKey || !raw.secretKey) return null;
        return {
            bucket: raw.bucket,
            endpoint: raw.endpoint,
            region: raw.region ?? '',
            accessKey: raw.accessKey,
            secretKey: raw.secretKey,
        };
    }

    private buildStaticStorage(raw: IRawStorageSettings): IStaticPakStorage | null {
        if (!raw.bucket || !raw.endpoint || !raw.accessKey || !raw.secretKey) return null;
        return {
            bucket: raw.bucket,
            endpoint: raw.endpoint,
            region: raw.region ?? '',
            accessKey: raw.accessKey,
            secretKey: raw.secretKey,
            pathStyle: raw.pathStyle,
        };
    }

    private buildSelectelStorage(raw: IRawStorageSettings): ISelectelPakStorage | null {
        if (!raw.bucket || !raw.endpoint || !raw.accessKey || !raw.secretKey) return null;
        const iam = raw.iam;
        if (
            !iam ||
            !iam.accountId ||
            !iam.projectName ||
            !iam.projectId ||
            !iam.username ||
            !iam.password
        ) {
            return null;
        }
        return {
            bucket: raw.bucket,
            endpoint: raw.endpoint,
            region: raw.region ?? '',
            accessKey: raw.accessKey,
            secretKey: raw.secretKey,
            basePrefix: raw.prefix ?? '',
            iam: {
                accountId: iam.accountId,
                projectName: iam.projectName,
                projectId: iam.projectId,
                username: iam.username,
                password: iam.password,
                identityUrl: iam.identityUrl,
                apiUrl: iam.apiUrl,
            },
        };
    }

    private failProvision(
        error: string,
    ): ICommandResponse<ProvisionFedarishaUserCommand.Response['response']> {
        return {
            isOk: true,
            response: { isOk: false, accessKey: null, secretKey: null, error },
        };
    }

    private failRevoke(
        error: string,
    ): ICommandResponse<RevokeFedarishaUserCommand.Response['response']> {
        return { isOk: true, response: { isOk: false, error } };
    }

    private failProbe(
        error: string,
    ): ICommandResponse<ProbeFedarishaUserCommand.Response['response']> {
        return { isOk: true, response: { isOk: false, exists: false, error } };
    }
}
