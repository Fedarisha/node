import { Agent } from 'undici';

import { Injectable, Logger } from '@nestjs/common';

import { IPakCreateResult, IPakProvider } from './pak-provider.interface';
import { probeS3Credentials } from './s3-probe.helper';

// Static pass-through provider. The configured `accessKey`/`secretKey`
// are handed to every panel user verbatim — no credential factory, no
// per-user scoping, no server-side enforcement. The panel still passes
// each user a distinct `prefix`, but honouring it is purely a client
// convention; the bucket itself accepts the configured credentials on
// any object inside it.
//
// Use when:
//   - the S3 backend has no credential-management API (vanilla
//     MinIO/Garage, R2 without IAM…),
//   - the deployment is single-tenant or fully trusted,
//   - you're prototyping the transport before wiring real isolation.
//
// Do NOT use in multi-tenant setups: every fedarisha user sees the
// same keypair and can read/overwrite every other user's prefix.

@Injectable()
export class StaticPakService implements IPakProvider {
    public readonly type = 'static';

    private readonly logger = new Logger(StaticPakService.name);
    private readonly httpAgent = new Agent({ connectTimeout: 5_000 });

    public async createKey(
        storage: IStaticPakStorage,
        userName: string,
        prefix: string,
    ): Promise<IPakCreateResult> {
        return {
            accessKey: storage.accessKey,
            secretKey: storage.secretKey,
            userName,
            prefix,
        };
    }

    public async deleteKey(): Promise<void> {
        // Nothing to revoke — the credential pair is shared across all
        // users and the panel keeps no provider-side record of it.
    }

    public async probeKey(
        storage: IStaticPakStorage,
        accessKey: string,
        secretKey: string,
        prefix: string,
    ): Promise<boolean> {
        // A keypair is "valid" iff it matches the one in the inbound
        // settings — anything else is a stale cache from a previous
        // config. We still exercise the round-trip so an operator who
        // rotated the static key in S3 but forgot to update the inbound
        // sees the failure surface as `exists: false`.
        if (accessKey !== storage.accessKey || secretKey !== storage.secretKey) {
            return false;
        }
        return probeS3Credentials(
            { ...storage, pathStyle: storage.pathStyle ?? false },
            accessKey,
            secretKey,
            prefix,
            this.httpAgent,
            this.logger,
        );
    }
}

export interface IStaticPakStorage {
    bucket: string;
    endpoint: string;
    region: string;
    accessKey: string;
    secretKey: string;
    // MinIO and most self-hosted S3 backends only speak path-style on
    // non-DNS endpoints. VK Cloud / Selectel are already handled by the
    // dedicated providers, so the static one defaults to virtual-host
    // off only if the caller asks.
    pathStyle?: boolean;
}
