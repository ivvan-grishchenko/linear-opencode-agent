import { Module } from '@nestjs/common';

import { OpencodeServiceProvider } from './opencode.provider';

@Module({
	exports: [OpencodeServiceProvider],
	providers: [OpencodeServiceProvider],
})
export class OpencodeModule {}
