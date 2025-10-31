pipeline {
    agent any

    tools {
        nodejs 'Node-18'
    }

    environment {
        // AWS Configuration
        AWS_ACCOUNT_ID = '395069634073'
        AWS_REGION = 'ap-south-1'
        AWS_DEFAULT_REGION = 'ap-south-1'
        ECS_CLUSTER = 'devsecops-app-cluster'
        ECS_SERVICE = 'devsecops-service'
        ECR_REPOSITORY = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/devsecops-app"
        
        // Local Configuration
        DOCKER_COMPOSE = 'docker-compose -f docker-compose.yml'
        SONARQUBE_URL = 'http://localhost:9000'
        PROJECT_KEY = 'DevSecOps-Pipeline-Project'
        SECURITY_REPORTS_DIR = 'security-reports'
        
        // Build Vars
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
                    docker system prune -f
                '''
            }
        }

        stage('Configure AWS CLI') {
            steps {
                script {
                    withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-ecr-prod']]) {
                        bat '''
                            aws --version
                            aws sts get-caller-identity
                            aws ecr describe-repositories --repository-names devsecops-app --region %AWS_REGION%
                            aws ecs describe-clusters --clusters %ECS_CLUSTER% --region %AWS_REGION%
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
                    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock ^
                        -v %cd%\\%SECURITY_REPORTS_DIR%:/reports ^
                        aquasec/trivy:latest image --format json --output /reports/trivy-container-report.json ^
                        devsecops-ci-app:latest || echo "Trivy scan completed with findings"

                    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock ^
                        -v %cd%\\%SECURITY_REPORTS_DIR%:/reports ^
                        aquasec/trivy:latest image --format template --template "@contrib/html.tpl" ^
                        --output /reports/trivy-container-report.html ^
                        devsecops-ci-app:latest || echo "Trivy HTML report generated"
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
                                def result = bat(
                                    script: 'curl -s -u admin:admin http://localhost:9000/api/system/health',
                                    returnStatus: true
                                )
                                return result == 0
                            }
                        }
                    }
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                bat '''
                    cd app
                    npm install
                '''
            }
        }

        stage('Security: Dependency Vulnerability Scan') {
            steps {
                bat '''
                    cd app
                    npm audit --audit-level moderate --json > ..\\%SECURITY_REPORTS_DIR%\\npm-audit.json || echo "Audit completed with findings"
                '''
            }
        }

        stage('Run Tests with Coverage') {
            steps {
                bat '''
                    cd app
                    npm test
                '''
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
                    sleep(10)
                }
            }
        }

        stage('Push to AWS ECR') {
            steps {
                script {
                    withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-ecr-prod']]) {
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
                    withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-ecr-prod']]) {
                        bat '''
                            aws ecs update-service ^
                                --cluster %ECS_CLUSTER% ^
                                --service %ECS_SERVICE% ^
                                --force-new-deployment ^
                                --region %AWS_REGION%
                            aws ecs wait services-stable ^
                                --cluster %ECS_CLUSTER% ^
                                --services %ECS_SERVICE% ^
                                --region %AWS_REGION%
                        '''
                    }
                }
            }
        }

        stage('Get ECS Service URL') {
            steps {
                script {
                    withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-ecr-prod']]) {
                        bat '''
                            for /f "tokens=*" %%i in ('aws ecs describe-services --cluster %ECS_CLUSTER% --services %ECS_SERVICE% --region %AWS_REGION% --query "services[0].loadBalancers[0].targetGroupArn" --output text') do set TG_ARN=%%i
                            for /f "tokens=*" %%j in ('aws elbv2 describe-target-groups --target-group-arns %TG_ARN% --region %AWS_REGION% --query "TargetGroups[0].LoadBalancerArns[0]" --output text') do set LB_ARN=%%j
                            for /f "tokens=*" %%k in ('aws elbv2 describe-load-balancers --load-balancer-arns %LB_ARN% --region %AWS_REGION% --query "LoadBalancers[0].DNSName" --output text') do set ECS_DNS=%%k
                            echo ECS Service URL: http://%%ECS_DNS%%
                            echo http://%%ECS_DNS%% > ecs_url.txt
                        '''
                    }
                }
            }
        }

        stage('AWS Health Check') {
            steps {
                script {
                    withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-ecr-prod']]) {
                        bat '''
                            powershell -Command "Start-Sleep -Seconds 30"
                            curl -f %ECS_SERVICE_URL% || echo "ECS service may need more time"
                            curl -f %ECS_SERVICE_URL%/health || echo "Health endpoint check"
                        '''
                    }
                }
            }
        }

        stage('Security: OWASP ZAP DAST on AWS ECS') {
            steps {
                script {
                    withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-ecr-prod']]) {
                        bat '''
                            docker run -dt --name owasp-zap-aws ^
                                -v %cd%\\%SECURITY_REPORTS_DIR%:/zap/reports:rw ^
                                -p 8091:8080 ^
                                ghcr.io/zaproxy/zaproxy:stable zap.sh -daemon -host 0.0.0.0 -port 8080 ^
                                -config api.addrs.addr.name=.* -config api.addrs.addr.regex=true

                            powershell -Command "Start-Sleep -Seconds 15"

                            docker exec owasp-zap-aws zap-baseline.py ^
                                -t %ECS_SERVICE_URL% ^
                                -J /zap/reports/zap-aws-ecs-baseline.json ^
                                -H /zap/reports/zap-aws-ecs-baseline.html ^
                                -r /zap/reports/zap-aws-ecs-baseline.md || echo "ZAP baseline completed with findings"

                            docker exec owasp-zap-aws zap-full-scan.py ^
                                -t %ECS_SERVICE_URL% ^
                                -J /zap/reports/zap-aws-ecs-full.json ^
                                -H /zap/reports/zap-aws-ecs-full.html || echo "ZAP full scan completed with findings"

                            docker stop owasp-zap-aws && docker rm owasp-zap-aws
                        '''
                    }
                }
            }
        }

        stage('Security: Secrets Scanning') {
            steps {
                bat '''
                    docker run --rm -v %cd%:/workdir ^
                        -v %cd%\\%SECURITY_REPORTS_DIR%:/reports ^
                        trufflesecurity/trufflehog:latest git file:///workdir ^
                        --json --no-update > %SECURITY_REPORTS_DIR%\\trufflehog-secrets.json || echo "Secrets scan completed"
                '''
            }
        }

        stage('Deploy') {
    steps {
        withCredentials([[$class: 'AmazonWebServicesCredentialsBinding', credentialsId: 'aws-ecr-prod']]) {
            bat 'aws sts get-caller-identity --region %AWS_REGION%'
            // Add other AWS CLI or SDK commands here for deployment
        }
    }
}


    post {
        always {
            archiveArtifacts artifacts: 'security-reports/**/*', fingerprint: true
        }
        success {
            echo '''
✅ Pipeline SUCCESSFUL!
            '''
        }
        failure {
            echo '''
❌ Pipeline FAILED - Check logs
            '''
        }
    }
}
}
}
