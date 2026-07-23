import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Inject,
	NotFoundException,
	Param,
	Post,
	Put,
	Query,
} from '@nestjs/common';

import type { CreateRepoMappingDto, UpdateRepoMappingDto } from './dto';
import type { IRepoMappingService } from './interface';

import { CreateRepoMappingSchema, UpdateRepoMappingSchema } from './dto';
import { RepoMappingInject } from './repo-mapping.enum';

@Controller('repo-mappings')
export class RepoMappingController {
	constructor(
		@Inject(RepoMappingInject.SERVICE)
		private readonly service: IRepoMappingService
	) {}

	@Get()
	list(@Query('organizationId') organizationId?: string) {
		return this.service.list(organizationId);
	}

	@Get(':organizationId/:projectId')
	async findByOrganizationAndProject(
		@Param('organizationId') organizationId: string,
		@Param('projectId') projectId: string
	) {
		const mapping = await this.service.findByOrganizationAndProject(organizationId, projectId);

		if (!mapping)
			throw new NotFoundException(
				`Repo mapping for organizationId=${organizationId}, projectId=${projectId} not found`
			);

		return mapping;
	}

	@Post()
	async create(@Body() body: CreateRepoMappingDto) {
		const parsed = CreateRepoMappingSchema.safeParse(body);

		if (!parsed.success) throw new BadRequestException(parsed.error.message);

		return this.service.create(parsed.data);
	}

	@Put(':organizationId/:projectId')
	@HttpCode(HttpStatus.OK)
	async update(
		@Param('organizationId') organizationId: string,
		@Param('projectId') projectId: string,
		@Body() body: UpdateRepoMappingDto
	) {
		const parsed = UpdateRepoMappingSchema.safeParse(body);

		if (!parsed.success) throw new BadRequestException(parsed.error.message);

		return this.service.update(organizationId, projectId, parsed.data);
	}

	@Delete(':organizationId/:projectId')
	@HttpCode(HttpStatus.NO_CONTENT)
	async delete(
		@Param('organizationId') organizationId: string,
		@Param('projectId') projectId: string
	) {
		await this.service.delete(organizationId, projectId);
	}
}
