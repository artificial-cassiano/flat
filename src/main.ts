import * as core from '@actions/core'
import { exec } from '@actions/exec'
import { execSync } from 'child_process'
import fetchHTTP from './backends/http'

import { getConfig, isHTTPConfig } from './config'
import { diff } from './git'

async function run(): Promise<void> {
  core.info('[INFO] Usage https://github.com/githubocto/flat#readme')
  core.startGroup('Configuration')
  const config = getConfig()
  const username = 'flat-data'
  await exec('git', ['config', 'user.name', username])
  await exec('git', [
    'config',
    'user.email',
    `${username}@users.noreply.github.com`,
  ])
  core.endGroup()

  core.startGroup('Fetch data')
  let filename = ''
  let source
  if (isHTTPConfig(config)) {
    filename = await fetchHTTP(config)
    source = config.http_url
 else {
    // typescript should preclude us from ever being here
    // because config is HTTPConfig | SQLConfig
    // But to be on the safe side, blow up if execution
    // has reached this point.
    core.setFailed('Unable to read a coherent action configuration')
  }
  core.endGroup()

  if (config.postprocess) {
    core.startGroup('Postprocess')
    core.debug(`Invoking ${config.postprocess} with ${filename}...`)
    try {
      const raw = execSync(
        `deno run -q -A --unstable ${config.postprocess} ${filename}`
      ).toString()

      core.info("Deno output:")
      core.info(raw)

    } catch (error) {
      core.setFailed(error)
    }
    core.endGroup()
  }

  core.startGroup('File changes')

  const newUnstagedFiles = await execSync(
    'git ls-files --others --exclude-standard'
  ).toString()
  const modifiedUnstagedFiles = await execSync('git ls-files -m').toString()
  const editedFilenames = [
    ...newUnstagedFiles.split('\n'),
    ...modifiedUnstagedFiles.split('\n'),
  ].filter(Boolean)

  core.info('newUnstagedFiles')
  core.info(newUnstagedFiles + '')
  core.info('modifiedUnstagedFiles')
  core.info(modifiedUnstagedFiles + '')
  core.info('editedFilenames')
  core.info(JSON.stringify(editedFilenames))

  core.endGroup()

  core.startGroup('Calculating diffstat')

  const editedFiles = []
  for (const filename of editedFilenames) {
    core.debug(`git adding ${filename}…`)
    await exec('git', ['add', filename])
    const bytes = await diff(filename)
    // core.setOutput('delta_bytes', bytes)
    editedFiles.push({ name: filename, deltaBytes: bytes, source })
  }
  core.endGroup()

  core.startGroup('Committing new data')

  const alreadyEditedFiles = JSON.parse(process.env.FILES || '[]')
  core.info('alreadyEditedFiles')
  core.info(JSON.stringify(alreadyEditedFiles))

  core.info('editedFiles')
  core.info(JSON.stringify(editedFiles))

  const files = [...alreadyEditedFiles, ...editedFiles]
  core.exportVariable('FILES', files)
  
  core.endGroup()
}

run().catch(error => {
  core.setFailed('Workflow failed! ' + error.message)
})
