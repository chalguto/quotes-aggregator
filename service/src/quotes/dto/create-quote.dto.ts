import {
  IsEmail,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** Ensures effectiveDate is not in the past */
@ValidatorConstraint({ name: 'futureOrToday', async: false })
class FutureOrTodayConstraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    const date = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date >= today;
  }
  defaultMessage(): string {
    return 'effectiveDate cannot be in the past';
  }
}

/** Ensures expiryDate is strictly after effectiveDate */
@ValidatorConstraint({ name: 'expiryAfterEffective', async: false })
class ExpiryAfterEffectiveConstraint implements ValidatorConstraintInterface {
  validate(expiryDate: string, args: ValidationArguments): boolean {
    const obj = args.object as CreateQuoteDto;
    if (!obj.effectiveDate || !expiryDate) return true;
    return new Date(expiryDate) > new Date(obj.effectiveDate);
  }
  defaultMessage(): string {
    return 'expiryDate must be after effectiveDate';
  }
}

export enum DocumentType {
  AUTO = 'AUTO',
  HOME = 'HOME',
  LIFE = 'LIFE',
  HEALTH = 'HEALTH',
  TRAVEL = 'TRAVEL',
}

export class CreateQuoteDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @Matches(/^[A-Z0-9\-]+$/, {
    message: 'documentId must match pattern ^[A-Z0-9\\-]+$',
  })
  documentId: string;

  @IsEnum(DocumentType, {
    message: 'documentType must be one of: AUTO, HOME, LIFE, HEALTH, TRAVEL',
  })
  documentType: DocumentType;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  insuredName: string;

  @IsEmail({}, { message: 'insuredEmail must be a valid email address' })
  @Transform(({ value }) => (value as string)?.toLowerCase().trim())
  insuredEmail: string;

  @IsNumber({}, { message: 'coverageAmount must be a number' })
  @Min(0.01)
  @Max(10_000_000)
  coverageAmount: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a valid 3-letter ISO 4217 code',
  })
  currency: string;

  @IsISO8601({}, { message: 'effectiveDate must be a valid date (ISO 8601 format)' })
  @Validate(FutureOrTodayConstraint)
  effectiveDate: string;

  @IsISO8601({}, { message: 'expiryDate must be a valid date (ISO 8601 format)' })
  @Validate(ExpiryAfterEffectiveConstraint)
  expiryDate: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
