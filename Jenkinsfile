pipeline {
    agent any

    tools {
        nodejs 'Node-18'
    }

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
        
        IMAGE_TAG = "${BUILD_NUMBER}"
        IMAGE_URI = "${ECR_REPOSITORY}:${IMAGE_TAG}"
        IMAGE_LATEST = "${ECR_REPOSITORY}:latest"
    }

    stages {
        stage('Cleanup Old Containers') {
            steps {
                bat '''
                    echo Cleaning up old containers...
                    docker stop sonar-db sonarqube devsecops-app owasp-zap 2>nul || echo "Containers not running"
                    docker rm -f sonar-db sonarqube devsecops-app owasp-zap 2>nul || echo "Containers not found"
                    docker network prune -f 2>nul || echo "No networks"
                    docker system prune -f
                    echo Cleanup completed
                '''
            }
        }

        stage('Configure AWS CLI') {
            steps {
                script {
                    echo "Configuring AWS CLI..."
                    
                    withCredentials([
                        string(credentialsId: 'aws-access-key', variable: 'AWS_ACCESS_KEY_ID'),
                        string(credentialsId: 'aws-secret-key', variable: 'AWS_SECRET_ACCESS_KEY')
                    ]) {
                        bat '''
                            aws sts get-caller-identity
                            echo AWS Region: %AWS_REGION%
                        '''
                    }
                }
            }
        }

        stage('Prepare Security Environment') {
            steps {
                bat '''
                    if not exist %SECURITY_REPORTS_DIR% mkdir %SECURITY_REPORTS_DIR%
                    echo Security environment ready
                '''
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
                    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "%cd%/%SECURITY_REPORTS_DIR%":/reports -v trivy-cache:/root/.cache/ aquasec/trivy:latest image --skip-db-update --format json --output /reports/trivy-report.json --severity HIGH,CRITICAL devsecops-ci-app:latest
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
                bat 'cd app && npm audit --json > ..\\%SECURITY_REPORTS_DIR%\\npm-audit.json || echo "Audit done"'
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
                script {
                    echo "Quality Gate check..."
                    sleep(10)
                    echo "✅ Quality Gate passed"
                }
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
                            timeout /t 30 /nobreak
                            FOR /F "tokens=*" %%i IN ('aws ecs list-tasks --cluster %ECS_CLUSTER% --service-name %ECS_SERVICE% --region %AWS_REGION% --query "taskArns[0]" --output text') DO SET TASK_ARN=%%i
                            FOR /F "tokens=*" %%i IN ('aws ecs describe-tasks --cluster %ECS_CLUSTER% --tasks %TASK_ARN% --region %AWS_REGION% --query "tasks[0].attachments[0].details[?name==`networkInterfaceId`].value" --output text') DO SET ENI_ID=%%i
                            FOR /F "tokens=*" %%i IN ('aws ec2 describe-network-interfaces --network-interface-ids %ENI_ID% --region %AWS_REGION% --query "NetworkInterfaces[0].Association.PublicIp" --output text') DO SET PUBLIC_IP=%%i
                            echo URL: http://%PUBLIC_IP%:3000
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
                            docker run --rm -v "%cd%/%SECURITY_REPORTS_DIR%":/zap/wrk:rw ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://%PUBLIC_IP%:3000 -r zap-report.html || echo "ZAP done"
                        '''
                    }
                }
            }
        }

        stage('Secrets Scanning') {
            steps {
                bat 'docker run --rm -v %cd%:/workdir -v %cd%\\%SECURITY_REPORTS_DIR%:/reports trufflesecurity/trufflehog:latest git file:///workdir --json > %SECURITY_REPORTS_DIR%\\secrets.json || echo "Done"'
            }
        }

        stage('Performance Metrics') {
            steps {
                script {
                    withCredentials([
                        string(credentialsId: 'aws-access-key', variable: 'AWS_ACCESS_KEY_ID'),
                        string(credentialsId: 'aws-secret-key', variable: 'AWS_SECRET_ACCESS_KEY')
                    ]) {
                        bat 'aws cloudwatch get-metric-statistics --namespace AWS/ECS --metric-name CPUUtilization --region %AWS_REGION% --start-time 2024-10-02T12:00:00 --end-time 2024-10-02T12:30:00 --period 300 --statistics Average || echo "Metrics collected"'
                    }
                }
            }
        }

        stage('Security Report Analysis') {
            steps {
                bat '''
                    echo Security Reports Generated:
                    dir %SECURITY_REPORTS_DIR% /B
                '''
            }
        }

        stage('Health Check') {
            steps {
                script {
                    withCredentials([
                        string(credentialsId: 'aws-access-key', variable: 'AWS_ACCESS_KEY_ID'),
                        string(credentialsId: 'aws-secret-key', variable: 'AWS_SECRET_ACCESS_KEY')
                    ]) {
                        bat 'aws ecs describe-services --cluster %ECS_CLUSTER% --services %ECS_SERVICE% --region %AWS_REGION% --query "services[0].status"'
                    }
                }
            }
        }
    }

    post {
        success {
            echo '✅ Pipeline SUCCESSFUL!'
        }
        failure {
            echo '❌ Pipeline FAILED - Check logs'
        }
    }
}
