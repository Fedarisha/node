import { Module } from '@nestjs/common';

import { FedarishaPakController } from './fedarisha-pak.controller';
import { FedarishaPakService } from './fedarisha-pak.service';
import { SelectelPakService } from './selectel-pak.service';
import { StaticPakService } from './static-pak.service';
import { PakService } from './pak.service';

@Module({
    providers: [FedarishaPakService, PakService, SelectelPakService, StaticPakService],
    controllers: [FedarishaPakController],
    exports: [FedarishaPakService],
})
export class FedarishaPakModule {}
