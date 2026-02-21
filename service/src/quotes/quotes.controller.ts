import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../common/guards/auth.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { QuotesService } from './quotes.service';

/**
 * Handles all /api/v1/quotes endpoints.
 * Every route requires a valid Bearer token (AuthGuard).
 * POST additionally enforces idempotency (IdempotencyInterceptor).
 */
@Controller('api/v1/quotes')
@UseGuards(AuthGuard)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  /**
   * POST /api/v1/quotes
   * Creates a new insurance quote. Requires Idempotency-Key header (UUID v4).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  async create(
    @Body() dto: CreateQuoteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const idempotencyKey = (req as any).idempotencyKey as string | undefined;
    const quote = await this.quotesService.createQuote({ ...dto, idempotencyKey });
    res.setHeader('Location', `/api/v1/quotes/${quote.quoteId}`);
    return quote;
  }

  /**
   * GET /api/v1/quotes/:quoteId
   * Retrieves a previously created quote by its ID.
   */
  @Get(':quoteId')
  getById(@Param('quoteId') quoteId: string) {
    return this.quotesService.getQuoteById(quoteId);
  }
}
