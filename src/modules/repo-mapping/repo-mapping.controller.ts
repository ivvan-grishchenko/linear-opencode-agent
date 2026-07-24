import {
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
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';

import type { IRepoMappingService } from './interface';

import { CreateRepoMappingDto, RepoMappingResponseDto, UpdateRepoMappingDto } from './dto';
import { RepoMappingInject } from './repo-mapping.enum';

@ApiTags('repo-mappings')
@Controller('repo-mappings')
export class RepoMappingController {
	constructor(
		@Inject(RepoMappingInject.SERVICE)
		private readonly service: IRepoMappingService
	) {}

	@Get()
	@ApiOperation({
		description: 'Return all repo mappings, optionally filtered by Linear organization ID.',
		summary: 'List repo mappings',
	})
	@ApiQuery({
		description: 'Filter mappings by Linear organization ID.',
		name: 'organizationId',
		required: false,
		type: String,
	})
	@ZodResponse({ status: HttpStatus.OK, type: [RepoMappingResponseDto] })
	@ApiResponse({ description: 'Invalid query parameters.', status: HttpStatus.BAD_REQUEST })
	list(@Query('organizationId') organizationId?: string) {
		return this.service.list(organizationId);
	}

	@Get(':organizationId/:projectId')
	@ApiOperation({
		description: 'Return a single repo mapping by its composite key (organization + project).',
		summary: 'Get repo mapping',
	})
	@ApiParam({ description: 'Linear organization ID.', name: 'organizationId' })
	@ApiParam({ description: 'Linear project ID.', name: 'projectId' })
	@ZodResponse({ status: HttpStatus.OK, type: RepoMappingResponseDto })
	@ApiResponse({
		description: 'No mapping exists for the given organization/project pair.',
		status: HttpStatus.NOT_FOUND,
	})
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
	@ApiOperation({
		description: 'Create a new repo mapping for a Linear organization/project pair.',
		summary: 'Create repo mapping',
	})
	@ApiBody({ type: CreateRepoMappingDto })
	@ZodResponse({ status: HttpStatus.CREATED, type: RepoMappingResponseDto })
	@ApiResponse({ description: 'Invalid request body.', status: HttpStatus.BAD_REQUEST })
	@ApiResponse({
		description: 'A mapping already exists for the given organization/project pair.',
		status: HttpStatus.CONFLICT,
	})
	create(@Body() body: CreateRepoMappingDto) {
		return this.service.create(body);
	}

	@Put(':organizationId/:projectId')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		description: 'Update the repository name for an existing mapping.',
		summary: 'Update repo mapping',
	})
	@ApiParam({ description: 'Linear organization ID.', name: 'organizationId' })
	@ApiParam({ description: 'Linear project ID.', name: 'projectId' })
	@ApiBody({ type: UpdateRepoMappingDto })
	@ZodResponse({ status: HttpStatus.OK, type: RepoMappingResponseDto })
	@ApiResponse({ description: 'Invalid request body.', status: HttpStatus.BAD_REQUEST })
	@ApiResponse({
		description: 'No mapping exists for the given organization/project pair.',
		status: HttpStatus.NOT_FOUND,
	})
	update(
		@Param('organizationId') organizationId: string,
		@Param('projectId') projectId: string,
		@Body() body: UpdateRepoMappingDto
	) {
		return this.service.update(organizationId, projectId, body);
	}

	@Delete(':organizationId/:projectId')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({
		description: 'Delete an existing repo mapping.',
		summary: 'Delete repo mapping',
	})
	@ApiParam({ description: 'Linear organization ID.', name: 'organizationId' })
	@ApiParam({ description: 'Linear project ID.', name: 'projectId' })
	@ApiResponse({ description: 'Mapping deleted successfully.', status: HttpStatus.NO_CONTENT })
	@ApiResponse({
		description: 'No mapping exists for the given organization/project pair.',
		status: HttpStatus.NOT_FOUND,
	})
	async delete(
		@Param('organizationId') organizationId: string,
		@Param('projectId') projectId: string
	) {
		await this.service.delete(organizationId, projectId);
	}
}
