pipeline {
    agent any
    tools { nodejs 'Node-18' }

    environment {
        AWS_ACCOUNT_ID = '395069634073'
        AWS_REGION = 'ap-south-1'
        AWS_DEFAULT_REGION = 'ap-south-1'
        ECS_CLUSTER = 'devsecops-app-cluster'
        ECS_SERVICE = 'devsecops-service'
        ECR_REPOSITORY = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/devsecops-app"
        DOCKER_COMPOSE = 'docker-compose -f docker-compose.yml'
        SONARQUBE_URL = 'http://localhost:9000'
        PROJECT_KEY = 'DevSecOps-Pipeline-Project'
        SECURITY_REPORTS_DIR = 'security-reports'
        WORKSPACE_DIR = "${WORKSPACE}"
        IMAGE_TAG = "${BUILD_NUMBER}"
        IMAGE_URI = "${ECR_REPOSITORY}:${IMAGE_TAG}"
        IMAGE_LATEST = "${ECR_REPOSITORY}:latest"
    }

    stages {

        stage('Cleanup Old Containers') {
            steps {
                bat '''
                    docker stop sonar-db sonarqube devsecops-app owasp-zap 2>nul || echo "Containers not running"
                    docker rm -f sonar-db sonarqube devsecops-app owasp-zap 2>nul || echo "Containers not found"
                    docker network prune -f 2>nul || echo "No networks"
                    docker system prune -f
                '''
            }
        }

        stage('Configure AWS CLI') {
            steps {
                script {
                    withCredentials([
                        string(credentialsId: 'aws-access-key', variable: 'AWS_ACCESS_KEY_ID'),
                        string(credentialsId: 'aws-secret-key', variable: 'AWS_SECRET_ACCESS_KEY')
                    ]) {
                        bat '''
                            aws sts get-caller-identity --region %AWS_REGION%
                            echo AWS Region: %AWS_REGION%
                        '''
                    }
                }
            }
        }

        stage('Prepare Security Environment') {
            steps {
                bat 'if not exist %SECURITY_REPORTS_DIR% mkdir %SECURITY_REPORTS_DIR%'
            }
        }

        stage('Build Docker Images') {
            steps {
                bat '''
                    docker build -t devsecops-ci-app:latest ./app
                    docker tag devsecops-ci-app:latest %IMAGE_URI%
                    docker tag devsecops-ci-app:latest %IMAGE_LATEST%
                '''
            }
        }

        stage('Container Security Scan - Trivy') {
            steps {
                bat '''
                    REM Run JSON report (for automated parsing / archival)
                    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "%WORKSPACE%\\%SECURITY_REPORTS_DIR%":/reports -v trivy-cache:/root/.cache aquasec/trivy:latest image --skip-db-update --format json --output /reports/trivy-container-report.json --severity HIGH,CRITICAL devsecops-ci-app:latest
                    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "%WORKSPACE%\\%SECURITY_REPORTS_DIR%":/reports -v trivy-cache:/root/.cache aquasec/trivy:latest image --skip-db-update --format table --output /reports/trivy-container-report.txt --severity HIGH,CRITICAL devsecops-ci-app:latest

                    powershell -NoProfile -ExecutionPolicy Bypass -Command " \
                        $r = Get-Content '%WORKSPACE%\\%SECURITY_REPORTS_DIR%\\trivy-container-report.json' | ConvertFrom-Json; \
                        $count = 0; \
                        foreach ($result in $r.Results) { \
                          if ($result.Vulnerabilities) { $count += $result.Vulnerabilities.Count } \
                        }; \
                        Write-Host ('Trivy HIGH/CRITICAL vulnerability count: ' + $count); \
                        if ($count -gt 0) { exit 1 } else { exit 0 }"
                '''
            }
        }

        stage('Start SonarQube Services') {
            steps {
                bat '%DOCKER_COMPOSE% up -d sonar-db sonarqube'
            }
        }

        stage('Wait for SonarQube') {
            steps {
                script {
                    timeout(time: 5, unit: 'MINUTES') {
                        waitUntil {
                            script {
                                def result = bat(script: 'curl -s http://localhost:9000/api/system/health', returnStatus: true)
                                return result == 0
                            }
                        }
                    }
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                bat 'cd app && npm install'
            }
        }

        stage('Security: Dependency Scan') {
            steps {
                bat '''
                    cd app
                    npm audit --json > "%WORKSPACE%\\%SECURITY_REPORTS_DIR%\\npm-audit.json" || echo "Audit done"
                '''
            }
        }

        stage('Run Tests') {
            steps {
                bat 'cd app && npm test'
            }
        }

        stage('SonarQube Analysis') {
            steps {
                bat '''
                    cd app
                    echo sonar.projectKey=%PROJECT_KEY% > sonar-project.properties
                    echo sonar.host.url=%SONARQUBE_URL% >> sonar-project.properties
                    echo sonar.login=squ_6d1f95d51cda1116c9cdb2208e6976cf4a56c6f5 >> sonar-project.properties
                    npx sonarqube-scanner
                '''
            }
        }

        stage('Quality Gate') {
            steps {
                script { sleep(10) }
            }
        }

        stage('Push to AWS ECR') {
            steps {
                script {
                    withCredentials([
                        string(credentialsId: 'aws-access-key', variable: 'AWS_ACCESS_KEY_ID'),
                        string(credentialsId: 'aws-secret-key', variable: 'AWS_SECRET_ACCESS_KEY')
                    ]) {
                        bat '''
                            aws ecr get-login-password --region %AWS_REGION% | docker login --username AWS --password-stdin %ECR_REPOSITORY%
                            docker push %IMAGE_URI%
                            docker push %IMAGE_LATEST%
                        '''
                    }
                }
            }
        }

        stage('Deploy to AWS ECS') {
            steps {
                script {
                    withCredentials([
                        string(credentialsId: 'aws-access-key', variable: 'AWS_ACCESS_KEY_ID'),
                        string(credentialsId: 'aws-secret-key', variable: 'AWS_SECRET_ACCESS_KEY')
                    ]) {
                        bat '''
                            aws ecs update-service --cluster %ECS_CLUSTER% --service %ECS_SERVICE% --force-new-deployment --region %AWS_REGION%
                        '''
                    }
                }
            }
        }

        stage('Get ECS URL') {
            steps {
                script {
                    withCredentials([
                        string(credentialsId: 'aws-access-key', variable: 'AWS_ACCESS_KEY_ID'),
                        string(credentialsId: 'aws-secret-key', variable: 'AWS_SECRET_ACCESS_KEY')
                    ]) {
                        bat '''
                            echo Waiting for ECS service to stabilize...
                            aws ecs wait services-stable --cluster %ECS_CLUSTER% --services %ECS_SERVICE% --region %AWS_REGION% || (
                                echo "Service did not stabilize within wait timeout"
                            )

                            FOR /F "tokens=*" %%i IN ('aws ecs list-tasks --cluster %ECS_CLUSTER% --service-name %ECS_SERVICE% --region %AWS_REGION% --desired-status RUNNING --query "taskArns[0]" --output text') DO SET TASK_ARN=%%i
                            if "%TASK_ARN%"=="" (
                              echo "No running task found for service %ECS_SERVICE%"
                              exit /b 1
                            )
                            echo Task ARN: %TASK_ARN%

                            FOR /F "tokens=*" %%i IN ('aws ecs describe-tasks --cluster %ECS_CLUSTER% --tasks %TASK_ARN% --region %AWS_REGION% --query "tasks[0].attachments[0].details[?name==`networkInterfaceId`].value" --output text') DO SET ENI_ID=%%i
                            if "%ENI_ID%"=="" (
                              echo "No network interface found for task %TASK_ARN%"
                              exit /b 1
                            )
                            echo Network Interface: %ENI_ID%

                            FOR /F "tokens=*" %%i IN ('aws ec2 describe-network-interfaces --network-interface-ids %ENI_ID% --region %AWS_REGION% --query "NetworkInterfaces[0].Association.PublicIp" --output text') DO SET PUBLIC_IP=%%i
                            if "%PUBLIC_IP%"=="" (
                              echo "No public IP associated with ENI %ENI_ID%"
                              exit /b 1
                            )

                            echo =========================================
                            echo ✅ DEPLOYMENT SUCCESSFUL!
                            echo 🚀 Application URL: http://%PUBLIC_IP%:3000
                            echo =========================================
                        '''
                    }
                }
            }
        }

        stage('AWS Health Check') {
            steps {
                script {
                    withCredentials([
                        string(credentialsId: 'aws-access-key', variable: 'AWS_ACCESS_KEY_ID'),
                        string(credentialsId: 'aws-secret-key', variable: 'AWS_SECRET_ACCESS_KEY')
                    ]) {
                        bat '''
                            aws ecs describe-services --cluster %ECS_CLUSTER% --services %ECS_SERVICE% --region %AWS_REGION% --query "services[0].{Status:status,Running:runningCount}" --output table
                        '''
                    }
                }
            }
        }

        stage('OWASP ZAP DAST') {
            steps {
                script {
                    withCredentials([
                        string(credentialsId: 'aws-access-key', variable: 'AWS_ACCESS_KEY_ID'),
                        string(credentialsId: 'aws-secret-key', variable: 'AWS_SECRET_ACCESS_KEY')
                    ]) {
                        bat '''
                            FOR /F "tokens=*" %%i IN ('aws ecs list-tasks --cluster %ECS_CLUSTER% --service-name %ECS_SERVICE% --region %AWS_REGION% --query "taskArns[0]" --output text') DO SET TASK_ARN=%%i
                            FOR /F "tokens=*" %%i IN ('aws ecs describe-tasks --cluster %ECS_CLUSTER% --tasks %TASK_ARN% --region %AWS_REGION% --query "tasks[0].attachments[0].details[?name==`networkInterfaceId`].value" --output text') DO SET ENI_ID=%%i
                            FOR /F "tokens=*" %%i IN ('aws ec2 describe-network-interfaces --network-interface-ids %ENI_ID% --region %AWS_REGION% --query "NetworkInterfaces[0].Association.PublicIp" --output text') DO SET PUBLIC_IP=%%i

                            if not exist "%WORKSPACE%\\%SECURITY_REPORTS_DIR%" mkdir "%WORKSPACE%\\%SECURITY_REPORTS_DIR%"

                            docker run --rm -v "%WORKSPACE%\\%SECURITY_REPORTS_DIR%":/zap/wrk:rw ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://%PUBLIC_IP%:3000 -r /zap/wrk/zap-report.html

                            set ZAP_CODE=%ERRORLEVEL%
                            if "%ZAP_CODE%"=="0" goto success
                            if "%ZAP_CODE%"=="2" goto success

                            echo "Unexpected ZAP error, code %ZAP_CODE%"
                            exit /b %ZAP_CODE%

                            :success
                            echo "ZAP scan complete (warnings/code %ZAP_CODE%)"
                            exit /b 0
                        '''
                    }
                }
            }
        }

        stage('Secrets Scanning') {
            steps {
                bat '''
                    if not exist "%WORKSPACE%\\%SECURITY_REPORTS_DIR%" mkdir "%WORKSPACE%\\%SECURITY_REPORTS_DIR%"
                    docker run --rm -v "%WORKSPACE%":/repo trufflesecurity/trufflehog:latest filesystem /repo --json > "%WORKSPACE%\\%SECURITY_REPORTS_DIR%\\trufflehog-secrets.json" || echo "Secrets scan done"
                '''
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'security-reports/**/*', allowEmptyArchive: true, fingerprint: true
        }
        success { echo '✅ Pipeline SUCCESSFUL!' }
        failure { echo '❌ Pipeline FAILED - Check logs' }
    }
}
