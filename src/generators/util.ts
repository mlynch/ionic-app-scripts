import { basename, dirname, join, relative } from 'path';
import { readdirSync } from 'fs';
import { Logger} from '../logger/logger';

import { paramCase, pascalCase, upperCaseFirst } from 'change-case';

import * as Constants from '../util/constants';
import * as GeneratorConstants from './constants';
import { getPropertyValue, getStringPropertyValue, mkDirpAsync, readFileAsync, replaceAll, writeFileAsync } from '../util/helpers';
import { BuildContext } from '../util/interfaces';
import { globAll, GlobResult } from '../util/glob-util';
import { ensureSuffix, removeSuffix } from '../util/helpers';
import { appendNgModuleDeclaration, insertNamedImportIfNeeded } from '../util/typescript-utils';

export function hydrateRequest(context: BuildContext, request: GeneratorRequest) {
  const hydrated = Object.assign({ includeNgModule: true }, request) as HydratedGeneratorRequest;
  hydrated.className = ensureSuffix(pascalCase(request.name), upperCaseFirst(request.type));
  hydrated.fileName = removeSuffix(paramCase(request.name), `-${request.type}`);

  hydrated.dirToRead = join(getPropertyValue(Constants.ENV_VAR_IONIC_ANGULAR_TEMPLATE_DIR), request.type);

  const baseDir = getDirToWriteToByType(context, request.type);
  hydrated.dirToWrite = join(baseDir, hydrated.fileName);

  return hydrated;
}

export function readTemplates(pathToRead: string): Promise<Map<string, string>> {
  const fileNames = readdirSync(pathToRead);
  const absolutePaths = fileNames.map(fileName => {
    return join(pathToRead, fileName);
  });
  const filePathToContent = new Map<string, string>();
  const promises = absolutePaths.map(absolutePath => {
    const promise = readFileAsync(absolutePath);
    promise.then((fileContent: string) => {
      filePathToContent.set(absolutePath, fileContent);
    });
    return promise;
  });
  return Promise.all(promises).then(() => {
    return filePathToContent;
  });
}

export function filterOutTemplates(request: HydratedGeneratorRequest, templates: Map<string, string>) {
  const templatesToUseMap = new Map<string, string>();
  templates.forEach((fileContent: string, filePath: string) => {
    const newFileExtension = basename(filePath, GeneratorConstants.KNOWN_FILE_EXTENSION);
    const shouldSkip = (!request.includeNgModule && newFileExtension === GeneratorConstants.NG_MODULE_FILE_EXTENSION) || (!request.includeSpec && newFileExtension === GeneratorConstants.SPEC_FILE_EXTENSION);
    if (!shouldSkip) {
      templatesToUseMap.set(filePath, fileContent);
    }
  });
  return templatesToUseMap;
}

export function applyTemplates(request: HydratedGeneratorRequest, templates: Map<string, string>) {
  const appliedTemplateMap = new Map<string, string>();
  templates.forEach((fileContent: string, filePath: string) => {
    const classnameRemovedContent = replaceAll(fileContent, GeneratorConstants.CLASSNAME_VARIABLE, request.className);
    const fileNameRemovedContent = replaceAll(classnameRemovedContent, GeneratorConstants.FILENAME_VARIABLE, request.fileName);
    const suppliedNameRemovedContent = replaceAll(fileNameRemovedContent, GeneratorConstants.SUPPLIEDNAME_VARIABLE, request.name);
    appliedTemplateMap.set(filePath, suppliedNameRemovedContent);
  });
  return appliedTemplateMap;
}

export function writeGeneratedFiles(request: HydratedGeneratorRequest, processedTemplates: Map<string, string>): Promise<string[]> {
  const promises: Promise<any>[] = [];
  const createdFileList: string[] = [];
  processedTemplates.forEach((fileContent: string, filePath: string) => {
    const newFileExtension = basename(filePath, GeneratorConstants.KNOWN_FILE_EXTENSION);
    const newFileName = `${request.fileName}.${newFileExtension}`;
    const fileToWrite = join(request.dirToWrite, newFileName);
    createdFileList.push(fileToWrite);
    promises.push(createDirAndWriteFile(fileToWrite, fileContent));
  });
  return Promise.all(promises).then(() => {
    return createdFileList;
  });
}

function createDirAndWriteFile(filePath: string, fileContent: string) {
  const directory = dirname(filePath);
  return mkDirpAsync(directory).then(() => {
    return writeFileAsync(filePath, fileContent);
  });
}

export function getNgModules(context: BuildContext, types: string[]): Promise<GlobResult[]> {
  const ngModuleSuffix = getStringPropertyValue(Constants.ENV_NG_MODULE_FILE_NAME_SUFFIX);
  const patterns = types.map((type) => join(getDirToWriteToByType(context, type), '**', `*${ngModuleSuffix}`));
  return globAll(patterns);
}

export function getDirToWriteToByType(context: BuildContext, type: string) {
  if (type === Constants.COMPONENT) {
    return context.componentsDir;
  } else if (type === Constants.DIRECTIVE) {
    return context.directivesDir;
  } else if (type === Constants.PAGE) {
    return context.pagesDir;
  } else if (type === Constants.PIPE) {
    return context.pipesDir;
  } else if (type === Constants.PROVIDER) {
    return context.providersDir;
  }
  throw new Error(`Unknown Generator Type: ${type}`);
}

export function nonPageFileManipulation(context: BuildContext, name: string, ngModulePath: string, type: string) {
  const hydratedRequest = hydrateRequest(context, { type: type, name });
  return readFileAsync(ngModulePath).then((fileContent: string) => {
    fileContent = insertNamedImportIfNeeded(ngModulePath, fileContent, hydratedRequest.className, relative(dirname(ngModulePath), hydratedRequest.dirToWrite));
    fileContent = appendNgModuleDeclaration(ngModulePath, fileContent, hydratedRequest.className);
    return writeFileAsync(ngModulePath, fileContent);
  }).then(() => {
    return processNonTabRequest(context, hydratedRequest);
  }).then(() => {
    // TODO
  });
}

export function processNonTabRequest(context: BuildContext, request: GeneratorRequest): Promise<string[]> {
  Logger.debug('[Generators] processNonTabRequest: Hydrating the request with project data ...');
  const hydratedRequest = hydrateRequest(context, request);
  Logger.debug('[Generators] processNonTabRequest: Reading templates ...');
  return readTemplates(hydratedRequest.dirToRead).then((map: Map<string, string>) => {
    Logger.debug('[Generators] processNonTabRequest: Filtering out NgModule and Specs if needed ...');
    return filterOutTemplates(hydratedRequest, map);
  }).then((filteredMap: Map<string, string>) => {
    Logger.debug('[Generators] processNonTabRequest: Applying tempaltes ...');
    const appliedTemplateMap = applyTemplates(hydratedRequest, filteredMap);
    Logger.debug('[Generators] processNonTabRequest: Writing generated files to disk ...');
    return writeGeneratedFiles(hydratedRequest, appliedTemplateMap);
  });
}

export interface GeneratorOption {
  type: string;
  multiple: boolean;
};

export interface GeneratorRequest {
  type?: string;
  name?: string;
  includeSpec?: boolean;
  includeNgModule?: boolean;
};

export interface HydratedGeneratorRequest extends GeneratorRequest {
  fileName?: string;
  className?: string;
  dirToRead?: string;
  dirToWrite?: string;
};
